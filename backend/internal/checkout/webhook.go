package checkout

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/email"

	"github.com/jackc/pgx/v5"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/webhook"
)

// StripeWebhook verifies the Stripe signature and processes the event. The
// webhook route is mounted WITHOUT CSRF middleware — Stripe authenticates
// with its `Stripe-Signature` header instead.
func (h *Handler) StripeWebhook(w http.ResponseWriter, r *http.Request) {
	const maxBody = 1 << 20 // 1 MiB
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	sigHeader := r.Header.Get("Stripe-Signature")
	// IgnoreAPIVersionMismatch: the account is pinned to a newer Stripe API
	// version than stripe-go ships with. We parse only the fields we care about
	// (metadata.order_id, refunds) so the schema drift doesn't matter for us.
	event, err := webhook.ConstructEventWithOptions(body, sigHeader, h.pay.WebhookSecret(), webhook.ConstructEventOptions{
		IgnoreAPIVersionMismatch: true,
	})
	if err != nil {
		slog.Warn("stripe webhook signature rejected",
			"err", err,
			"secret_prefix", firstN(h.pay.WebhookSecret(), 15),
			"sig_prefix", firstN(sigHeader, 40),
			"body_len", len(body))
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	log := slog.Default().With("webhook", "stripe", "type", event.Type, "id", event.ID)

	switch event.Type {
	case "payment_intent.succeeded":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			log.Error("unmarshal pi", "err", err)
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		orderID := pi.Metadata["order_id"]
		if orderID == "" {
			log.Warn("missing order_id in metadata")
			w.WriteHeader(http.StatusOK)
			return
		}
		if err := h.markOrderPaid(r, orderID, pi.ID); err != nil {
			log.Error("markOrderPaid", "err", err)
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}
		log.Info("order paid", "order_id", orderID)
		// Fire the confirmation email asynchronously — failure to deliver
		// must never block the webhook ack.
		email.SendOrderConfirmation(r.Context(), h.db, h.cfg, orderID)

	case "payment_intent.payment_failed":
		var pi stripe.PaymentIntent
		if err := json.Unmarshal(event.Data.Raw, &pi); err != nil {
			log.Error("unmarshal pi", "err", err)
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		_, _ = h.db.Exec(r.Context(), `
            UPDATE payments SET status = 'failed', updated_at = now()
            WHERE provider = 'stripe' AND provider_ref = $1
        `, pi.ID)
		log.Info("payment failed", "pi", pi.ID)

	case "charge.refunded":
		// charge.refunded fires when ANY refund lands on a charge (dashboard or API).
		// We look up the order via the charge's PaymentIntent → metadata.order_id
		// and insert a refund row if we don't already have one with that id.
		if err := h.handleChargeRefunded(r, event.Data.Raw); err != nil {
			log.Error("handleChargeRefunded", "err", err)
			http.Error(w, "internal", http.StatusInternalServerError)
			return
		}

	default:
		log.Debug("ignored event")
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) markOrderPaid(r *http.Request, orderID, paymentIntentID string) error {
	ctx := r.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Idempotent: only flip if we weren't already paid.
	var currentStatus string
	err = tx.QueryRow(ctx, `SELECT financial_status FROM orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&currentStatus)
	if err != nil {
		return err
	}
	if currentStatus == "paid" {
		return tx.Commit(ctx)
	}

	_, err = tx.Exec(ctx, `
        UPDATE orders SET status = 'paid', financial_status = 'paid',
                          paid_at = now(), updated_at = now()
        WHERE id = $1
    `, orderID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        UPDATE payments SET status = 'succeeded', updated_at = now()
        WHERE provider = 'stripe' AND provider_ref = $1
    `, paymentIntentID)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'paid', $2)
    `, orderID, map[string]any{"payment_intent_id": paymentIntentID, "at": time.Now().UTC()})
	if err != nil {
		return err
	}

	// Delete the cart tied to this order (by customer or by remaining cart_token).
	// Best-effort: failure here doesn't block the webhook.
	_, _ = tx.Exec(ctx, `
        DELETE FROM carts WHERE customer_id = (SELECT customer_id FROM orders WHERE id = $1) AND customer_id IS NOT NULL
    `, orderID)

	return tx.Commit(ctx)
}

func firstN(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// handleChargeRefunded picks up refunds created outside our admin (Dashboard
// or Stripe CLI) and makes them visible in our order history. Idempotent via
// the refunds.provider_ref UNIQUE index.
func (h *Handler) handleChargeRefunded(r *http.Request, raw []byte) error {
	ctx := r.Context()
	var charge stripe.Charge
	if err := json.Unmarshal(raw, &charge); err != nil {
		return err
	}
	pi := ""
	if charge.PaymentIntent != nil {
		pi = charge.PaymentIntent.ID
	}
	if pi == "" {
		return nil
	}
	// Find the order via PaymentIntent → order_id in metadata.
	var orderID string
	err := h.db.QueryRow(ctx,
		`SELECT order_id FROM payments WHERE provider = 'stripe' AND provider_ref = $1`, pi,
	).Scan(&orderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	// Iterate through each refund on the charge.
	if charge.Refunds == nil {
		return nil
	}
	for _, ref := range charge.Refunds.Data {
		// Idempotency check.
		var exists bool
		if err := h.db.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM refunds WHERE provider_ref = $1)`, ref.ID,
		).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		_, err := h.db.Exec(ctx, `
            INSERT INTO refunds (order_id, provider_ref, amount_cents, currency, reason, note)
            VALUES ($1, $2, $3, $4, 'stripe_dashboard', '')
        `, orderID, ref.ID, int(ref.Amount), strings.ToUpper(string(ref.Currency)))
		if err != nil {
			return err
		}
	}
	// Recompute financial_status.
	var total, refunded int
	var fs string
	err = h.db.QueryRow(ctx, `
        SELECT total_cents, COALESCE((SELECT SUM(amount_cents) FROM refunds WHERE order_id = $1), 0), financial_status
        FROM orders WHERE id = $1
    `, orderID).Scan(&total, &refunded, &fs)
	if err != nil {
		return err
	}
	newFin := fs
	newStatus := fs
	switch {
	case refunded >= total:
		newFin, newStatus = "refunded", "refunded"
	case refunded > 0:
		newFin, newStatus = "partially_refunded", "partially_refunded"
	}
	_, err = h.db.Exec(ctx, `
        UPDATE orders SET financial_status = $1, status = $2, updated_at = now() WHERE id = $3
    `, newFin, newStatus, orderID)
	return err
}
