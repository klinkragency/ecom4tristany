package order

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/payments"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// RefundHandler has access to the Stripe client; the plain Handler doesn't so
// the refund endpoints live on a separate struct mounted alongside it.
type RefundHandler struct {
	*Handler
	pay *payments.Client
}

func NewRefundHandler(h *Handler, pay *payments.Client) *RefundHandler {
	return &RefundHandler{Handler: h, pay: pay}
}

type RefundReq struct {
	AmountCents int    `json:"amountCents"`  // 0 = refund full remaining
	Reason      string `json:"reason"`       // internal note; free text
	Note        string `json:"note"`
	// Stripe's own reason codes (one of: duplicate, fraudulent, requested_by_customer).
	StripeReason string `json:"stripeReason"`
	// RefundTo chooses the destination. "card" (default) reverses the Stripe
	// charge. "store_credit" adds balance to the customer's store-credit
	// account instead (no Stripe call — requires order.customer_id).
	RefundTo string `json:"refundTo"`
}

// Create issues a refund against the order's Stripe payment. Supports full or
// partial amounts, and optionally refunds to store credit instead of the card.
// Records a row in `refunds`, updates order financial_status, logs an event.
func (h *RefundHandler) Create(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())

	var req RefundReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.RefundTo == "" {
		req.RefundTo = "card"
	}
	if req.RefundTo != "card" && req.RefundTo != "store_credit" {
		httpx.Error(w, http.StatusBadRequest, "invalid_refund_to", "refundTo must be 'card' or 'store_credit'")
		return
	}
	if req.RefundTo == "card" && !h.pay.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "payments_disabled",
			"Stripe not configured — set STRIPE_SECRET_KEY")
		return
	}

	// Pull the order + its current payment we want to refund.
	type orderRow struct {
		total      int
		refunded   int
		financial  string
		currency   string
		customerID *string
		paymentRef string
		paymentID  string
	}
	var o orderRow
	err := h.db.QueryRow(r.Context(), `
        SELECT o.total_cents, COALESCE(o.currency, 'EUR'),
               COALESCE((SELECT SUM(amount_cents) FROM refunds WHERE order_id = o.id), 0) AS refunded,
               o.financial_status,
               o.customer_id,
               COALESCE((SELECT provider_ref FROM payments WHERE order_id = o.id AND provider = 'stripe' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1), ''),
               COALESCE((SELECT id::text FROM payments WHERE order_id = o.id AND provider = 'stripe' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1), '')
        FROM orders o
        WHERE o.id = $1
    `, id).Scan(&o.total, &o.currency, &o.refunded, &o.financial, &o.customerID, &o.paymentRef, &o.paymentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if req.RefundTo == "card" && o.paymentRef == "" {
		httpx.Error(w, http.StatusConflict, "no_payment", "no captured Stripe payment on this order")
		return
	}
	if req.RefundTo == "store_credit" && o.customerID == nil {
		httpx.Error(w, http.StatusConflict, "no_customer", "cannot refund to store credit for a guest order")
		return
	}

	remaining := o.total - o.refunded
	if remaining <= 0 {
		httpx.Error(w, http.StatusConflict, "already_refunded", "order is fully refunded")
		return
	}
	amount := req.AmountCents
	if amount == 0 {
		amount = remaining
	}
	if amount > remaining {
		httpx.Error(w, http.StatusBadRequest, "amount_too_large",
			fmt.Sprintf("maximum refundable is %d cents", remaining))
		return
	}
	if amount <= 0 {
		httpx.Error(w, http.StatusBadRequest, "amount_invalid", "amount must be > 0")
		return
	}

	// Call Stripe only for card refunds.
	stripeRefundID := ""
	if req.RefundTo == "card" {
		stripeRefund, err := h.pay.Refund(o.paymentRef, int64(amount))
		if err != nil {
			httpx.Error(w, http.StatusBadGateway, "stripe_error", err.Error())
			return
		}
		stripeRefundID = stripeRefund.ID
	}

	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID.Bytes)
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// For store-credit refunds, leave provider_ref NULL. The existing partial
	// unique index already allows multiple NULLs so this doesn't collide.
	var providerRef any
	if stripeRefundID != "" {
		providerRef = stripeRefundID
	}
	_, err = tx.Exec(r.Context(), `
        INSERT INTO refunds (order_id, payment_id, provider_ref, amount_cents, currency, reason, note, created_by)
        VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, NULLIF($8, '')::uuid)
    `, id, o.paymentID, providerRef, amount, o.currency,
		refundReasonLabel(req.RefundTo, req.Reason), req.Note, adminID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "refund_insert", err.Error())
		return
	}

	// Store-credit refund: also credit the customer's account via the ledger.
	if req.RefundTo == "store_credit" && o.customerID != nil {
		_, err = tx.Exec(r.Context(), `
            INSERT INTO store_credit_ledger (customer_id, delta_cents, reason, note, order_id, admin_id)
            VALUES ($1, $2, 'refund', $3, $4, NULLIF($5, '')::uuid)
        `, *o.customerID, amount,
			fmt.Sprintf("Refund for order %s", id), id, adminID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "ledger_insert", err.Error())
			return
		}
	}

	newRefunded := o.refunded + amount
	newFinancial, newStatus := deriveAfterRefund(o.total, newRefunded, o.financial)
	_, err = tx.Exec(r.Context(), `
        UPDATE orders SET financial_status = $1, status = $2, updated_at = now()
        WHERE id = $3
    `, newFinancial, newStatus, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "order_update", err.Error())
		return
	}

	_, err = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, admin_id, payload)
        VALUES ($1, 'refunded', NULLIF($2, '')::uuid, $3)
    `, id, adminID, map[string]any{
		"amount_cents":  amount,
		"stripe_refund": stripeRefundID,
		"refund_to":     req.RefundTo,
		"reason":        req.Reason,
		"note":          req.Note,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "event_insert", err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	o2, err := h.Handler.load(r.Context(), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, o2)
}

// refundReasonLabel prefixes the human reason so finance reports can tell
// card and credit refunds apart without joining back to the order.
func refundReasonLabel(refundTo, userReason string) string {
	prefix := "card_refund"
	if refundTo == "store_credit" {
		prefix = "store_credit_refund"
	}
	if userReason == "" {
		return prefix
	}
	return prefix + ": " + userReason
}

// deriveAfterRefund computes the new (financial_status, status) pair based on
// how much of the total has been refunded.
func deriveAfterRefund(total, refunded int, oldFinancial string) (string, string) {
	switch {
	case refunded >= total:
		return "refunded", "refunded"
	case refunded > 0:
		// If order was paid, transition to partially_refunded; keep status as-is
		// unless it was pending (shouldn't happen for a successful refund).
		_ = oldFinancial
		return "partially_refunded", "partially_refunded"
	default:
		return oldFinancial, oldFinancial
	}
}

// SilentRefund is called from the webhook for refunds created out-of-band
// (e.g. via Stripe Dashboard). It upserts a refund row if we don't have one
// with the same provider_ref and updates order totals.
func (h *RefundHandler) SilentRefund(ctx context.Context, orderID, providerRef string, amountCents int, currency string) error {
	// Idempotency: skip if we already have this provider_ref recorded.
	var exists bool
	if err := h.db.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM refunds WHERE provider_ref = $1)`, providerRef,
	).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
        INSERT INTO refunds (order_id, provider_ref, amount_cents, currency, reason, note)
        VALUES ($1, $2, $3, $4, 'stripe_dashboard', 'Created out-of-band (Stripe Dashboard or CLI)')
    `, orderID, providerRef, amountCents, strings.ToUpper(currency))
	if err != nil {
		return err
	}
	var total, refunded int
	var fs string
	err = tx.QueryRow(ctx, `
        SELECT total_cents, COALESCE((SELECT SUM(amount_cents) FROM refunds WHERE order_id = $1), 0), financial_status
        FROM orders WHERE id = $1
    `, orderID).Scan(&total, &refunded, &fs)
	if err != nil {
		return err
	}
	newFin, newStatus := deriveAfterRefund(total, refunded, fs)
	_, err = tx.Exec(ctx, `
        UPDATE orders SET financial_status = $1, status = $2, updated_at = now() WHERE id = $3
    `, newFin, newStatus, orderID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'refunded', $2)
    `, orderID, map[string]any{"amount_cents": amountCents, "stripe_refund": providerRef, "source": "webhook"})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
