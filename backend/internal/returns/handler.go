// Package returns implements the RMA (return merchandise authorization) flow.
//
// Lifecycle:
//
//	requested → approved → received → refunded
//	         ↘ rejected        ↘ cancelled
//
// Customers open a return (`requested`); admins approve or reject. Once
// received at the warehouse an admin marks it received (optionally restocking
// inventory) then issues a refund (to card via Stripe, or to store credit).
//
// Storefront endpoints only operate on returns that belong to the logged-in
// customer. Admin endpoints can act on any return.
package returns

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/order"
	"github.com/3mg/shop/backend/internal/payments"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
	pay *payments.Client
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config, pay *payments.Client) *Handler {
	return &Handler{db: db, cfg: cfg, pay: pay}
}

// ─── DTOs ───────────────────────────────────────────────────────────────

type LineInput struct {
	OrderLineItemID string `json:"orderLineItemId"`
	Quantity        int    `json:"quantity"`
	Reason          string `json:"reason"`
	Note            string `json:"note"`
}

type RequestReq struct {
	OrderID      string      `json:"orderId"`
	CustomerNote string      `json:"customerNote"`
	Items        []LineInput `json:"items"`
}

type LineDTO struct {
	ID              string `json:"id"`
	OrderLineItemID string `json:"orderLineItemId"`
	ProductTitle    string `json:"productTitle"`
	VariantTitle    string `json:"variantTitle"`
	SKU             string `json:"sku"`
	UnitPriceCents  int    `json:"unitPriceCents"`
	Quantity        int    `json:"quantity"`
	Reason          string `json:"reason"`
	Note            string `json:"note"`
	Restocked       bool   `json:"restocked"`
}

type ReturnDTO struct {
	ID           string     `json:"id"`
	OrderID      string     `json:"orderId"`
	OrderNumber  string     `json:"orderNumber"`
	RMANumber    string     `json:"rmaNumber"`
	Status       string     `json:"status"`
	CustomerNote string     `json:"customerNote"`
	AdminNote    string     `json:"adminNote"`
	RefundID     *string    `json:"refundId,omitempty"`
	RequestedBy  string     `json:"requestedBy"`
	RequestedAt  time.Time  `json:"requestedAt"`
	ApprovedAt   *time.Time `json:"approvedAt,omitempty"`
	ReceivedAt   *time.Time `json:"receivedAt,omitempty"`
	RefundedAt   *time.Time `json:"refundedAt,omitempty"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	Items        []LineDTO  `json:"items"`
	// Computed for convenience on admin screens.
	Currency      string `json:"currency"`
	EstimatedCents int    `json:"estimatedCents"`
}

var validReasons = map[string]bool{
	"wrong_item": true, "damaged": true, "doesnt_fit": true,
	"changed_mind": true, "not_as_described": true, "other": true,
}

// ─── Storefront: request a return ───────────────────────────────────────

func (h *Handler) CustomerRequest(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok || sess.UserType != session.TypeCustomer {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	cid := uuidString(sess.UserID.Bytes)
	var req RequestReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.OrderID == "" || len(req.Items) == 0 {
		httpx.Error(w, http.StatusBadRequest, "missing_fields", "orderId and at least one item required")
		return
	}

	// Enforce: order belongs to this customer AND it's in a state that can be
	// returned (paid or partially_refunded).
	var ownerID *string
	var financial string
	err := h.db.QueryRow(r.Context(),
		`SELECT customer_id, financial_status FROM orders WHERE id = $1`, req.OrderID,
	).Scan(&ownerID, &financial)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if ownerID == nil || *ownerID != cid {
		httpx.Error(w, http.StatusForbidden, "forbidden", "not your order")
		return
	}
	if financial != "paid" && financial != "partially_refunded" {
		httpx.Error(w, http.StatusConflict, "not_returnable",
			"only paid orders can be returned")
		return
	}
	dto, err := createReturn(r.Context(), h.db, req, "customer")
	if err != nil {
		httpx.Error(w, errCode(err), "create_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, dto)
}

// CustomerList returns the logged-in customer's returns (newest first).
func (h *Handler) CustomerList(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok || sess.UserType != session.TypeCustomer {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	cid := uuidString(sess.UserID.Bytes)
	items, err := listReturns(r.Context(), h.db, &cid, "")
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// CustomerGet returns a single return if it belongs to the customer.
func (h *Handler) CustomerGet(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok || sess.UserType != session.TypeCustomer {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	cid := uuidString(sess.UserID.Bytes)
	id := chi.URLParam(r, "id")
	dto, err := loadReturn(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "return not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	var owner *string
	_ = h.db.QueryRow(r.Context(),
		`SELECT customer_id FROM orders WHERE id = $1`, dto.OrderID,
	).Scan(&owner)
	if owner == nil || *owner != cid {
		httpx.Error(w, http.StatusForbidden, "forbidden", "not your return")
		return
	}
	httpx.JSON(w, http.StatusOK, dto)
}

// ─── Admin ──────────────────────────────────────────────────────────────

func (h *Handler) AdminList(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	orderID := r.URL.Query().Get("orderId")
	items, err := listReturnsAdmin(r.Context(), h.db, status, orderID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	dto, err := loadReturn(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "return not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, dto)
}

type AdminCreateReq = RequestReq

// AdminCreate lets staff open a return on the customer's behalf (e.g. if they
// called in by phone).
func (h *Handler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var req AdminCreateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.OrderID == "" || len(req.Items) == 0 {
		httpx.Error(w, http.StatusBadRequest, "missing_fields", "orderId and items required")
		return
	}
	dto, err := createReturn(r.Context(), h.db, req, "admin")
	if err != nil {
		httpx.Error(w, errCode(err), "create_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, dto)
}

type DecisionReq struct {
	AdminNote string `json:"adminNote"`
}

func (h *Handler) AdminApprove(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req DecisionReq
	_ = httpx.DecodeJSON(r, &req) // optional
	if err := transition(r.Context(), h.db, id, "approved", "requested", req.AdminNote, "approved_at"); err != nil {
		httpx.Error(w, errCode(err), "approve_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AdminReject(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req DecisionReq
	_ = httpx.DecodeJSON(r, &req)
	if err := transition(r.Context(), h.db, id, "rejected", "requested", req.AdminNote, ""); err != nil {
		httpx.Error(w, errCode(err), "reject_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ReceiveReq struct {
	AdminNote  string `json:"adminNote"`
	LocationID string `json:"locationId"` // required when Restock=true
	Restock    bool   `json:"restock"`
}

// AdminReceive marks a return as received. Optionally restocks the items
// back to a given location (inventory_levels increment).
func (h *Handler) AdminReceive(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req ReceiveReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Restock && strings.TrimSpace(req.LocationID) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_location",
			"locationId required when restocking")
		return
	}

	sess, _ := auth.SessionFromContext(r.Context())
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

	var status, orderID string
	if err := tx.QueryRow(r.Context(),
		`SELECT status, order_id FROM returns WHERE id = $1 FOR UPDATE`, id,
	).Scan(&status, &orderID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "return not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if status != "approved" {
		httpx.Error(w, http.StatusConflict, "bad_status",
			"only approved returns can be received")
		return
	}

	// Restock each return line.
	if req.Restock {
		rows, err := tx.Query(r.Context(), `
            SELECT rli.id, rli.quantity, oli.variant_id
            FROM return_line_items rli
            JOIN order_line_items oli ON oli.id = rli.order_line_item_id
            WHERE rli.return_id = $1
        `, id)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "lines_error", err.Error())
			return
		}
		type rli struct {
			id, variantID *string
			qty           int
		}
		var items []rli
		for rows.Next() {
			var liID string
			var vID *string
			var q int
			if err := rows.Scan(&liID, &q, &vID); err != nil {
				rows.Close()
				httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
				return
			}
			s := liID
			items = append(items, rli{id: &s, variantID: vID, qty: q})
		}
		rows.Close()
		for _, it := range items {
			if it.variantID == nil {
				continue
			}
			if _, err := tx.Exec(r.Context(), `
                INSERT INTO inventory_levels (variant_id, location_id, on_hand, updated_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (variant_id, location_id)
                DO UPDATE SET on_hand = inventory_levels.on_hand + $3, updated_at = now()
            `, *it.variantID, req.LocationID, it.qty); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "restock_error", err.Error())
				return
			}
			if _, err := tx.Exec(r.Context(), `
                INSERT INTO inventory_adjustments (variant_id, location_id, delta, reason, note, admin_id)
                VALUES ($1, $2, $3, 'return_restock', 'RMA restock', NULLIF($4, '')::uuid)
            `, *it.variantID, req.LocationID, it.qty, adminID); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "adj_error", err.Error())
				return
			}
			if _, err := tx.Exec(r.Context(),
				`UPDATE return_line_items SET restocked = true WHERE id = $1`, *it.id,
			); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "restock_flag_error", err.Error())
				return
			}
		}
	}

	note := strings.TrimSpace(req.AdminNote)
	_, err = tx.Exec(r.Context(), `
        UPDATE returns
        SET status = 'received', received_at = now(), updated_at = now(),
            admin_note = CASE WHEN $2 <> '' THEN $2 ELSE admin_note END
        WHERE id = $1
    `, id, note)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, admin_id, payload)
        VALUES ($1, 'return_received', NULLIF($2, '')::uuid, $3)
    `, orderID, adminID, map[string]any{"return_id": id, "restocked": req.Restock})

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type RefundReq struct {
	AmountCents int    `json:"amountCents"` // 0 = sum of estimated return line totals
	RefundTo    string `json:"refundTo"`    // 'card' | 'store_credit'
	Note        string `json:"note"`
}

// AdminRefund issues a refund against the order for this return and marks
// the return as 'refunded'. Only valid from the 'received' state.
func (h *Handler) AdminRefund(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
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
	if req.RefundTo == "card" && (h.pay == nil || !h.pay.Enabled()) {
		httpx.Error(w, http.StatusServiceUnavailable, "payments_disabled", "Stripe not configured")
		return
	}

	sess, _ := auth.SessionFromContext(r.Context())
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID.Bytes)
	}

	// Resolve return + order totals.
	var status, orderID string
	if err := h.db.QueryRow(r.Context(),
		`SELECT status, order_id FROM returns WHERE id = $1`, id,
	).Scan(&status, &orderID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "return not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if status != "received" {
		httpx.Error(w, http.StatusConflict, "bad_status",
			"only received returns can be refunded")
		return
	}

	// Pull order + payment info.
	var total, alreadyRefunded int
	var currency, financial string
	var customerID *string
	var paymentRef, paymentID string
	err := h.db.QueryRow(r.Context(), `
        SELECT o.total_cents, COALESCE((SELECT SUM(amount_cents) FROM refunds WHERE order_id = o.id), 0),
               COALESCE(o.currency, 'EUR'), o.financial_status, o.customer_id,
               COALESCE((SELECT provider_ref FROM payments WHERE order_id = o.id AND provider = 'stripe' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1), ''),
               COALESCE((SELECT id::text FROM payments WHERE order_id = o.id AND provider = 'stripe' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1), '')
        FROM orders o WHERE o.id = $1
    `, orderID).Scan(&total, &alreadyRefunded, &currency, &financial, &customerID,
		&paymentRef, &paymentID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "order_lookup_error", err.Error())
		return
	}
	if req.RefundTo == "card" && paymentRef == "" {
		httpx.Error(w, http.StatusConflict, "no_payment", "no captured Stripe payment on this order")
		return
	}
	if req.RefundTo == "store_credit" && customerID == nil {
		httpx.Error(w, http.StatusConflict, "no_customer", "cannot refund to store credit for a guest order")
		return
	}
	remaining := total - alreadyRefunded
	if remaining <= 0 {
		httpx.Error(w, http.StatusConflict, "already_refunded", "order is fully refunded")
		return
	}
	amount := req.AmountCents
	if amount == 0 {
		amount, err = estimatedRefundCents(r.Context(), h.db, id)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "estimate_error", err.Error())
			return
		}
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

	// Call Stripe if refunding to card.
	stripeRefundID := ""
	if req.RefundTo == "card" {
		sr, err := h.pay.Refund(paymentRef, int64(amount))
		if err != nil {
			httpx.Error(w, http.StatusBadGateway, "stripe_error", err.Error())
			return
		}
		stripeRefundID = sr.ID
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// Insert refund row.
	var refundID string
	var providerRef any
	if stripeRefundID != "" {
		providerRef = stripeRefundID
	}
	err = tx.QueryRow(r.Context(), `
        INSERT INTO refunds (order_id, payment_id, provider_ref, amount_cents, currency, reason, note, created_by)
        VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, NULLIF($8, '')::uuid)
        RETURNING id
    `, orderID, paymentID, providerRef, amount, currency,
		"return_refund_"+req.RefundTo, req.Note, adminID).Scan(&refundID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "refund_insert", err.Error())
		return
	}

	if req.RefundTo == "store_credit" && customerID != nil {
		if _, err := tx.Exec(r.Context(), `
            INSERT INTO store_credit_ledger (customer_id, delta_cents, reason, note, order_id, admin_id)
            VALUES ($1, $2, 'refund', $3, $4, NULLIF($5, '')::uuid)
        `, *customerID, amount, "Return refund for order "+orderID, orderID, adminID); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "ledger_insert", err.Error())
			return
		}
	}

	newRefunded := alreadyRefunded + amount
	newFinancial, newStatus := order.DeriveAfterRefund(total, newRefunded, financial)
	if _, err := tx.Exec(r.Context(), `
        UPDATE orders SET financial_status = $1, status = $2, updated_at = now() WHERE id = $3
    `, newFinancial, newStatus, orderID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "order_update", err.Error())
		return
	}

	if _, err := tx.Exec(r.Context(), `
        UPDATE returns
        SET status = 'refunded', refund_id = $2, refunded_at = now(), updated_at = now()
        WHERE id = $1
    `, id, refundID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "return_update", err.Error())
		return
	}
	_, _ = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, admin_id, payload)
        VALUES ($1, 'refunded', NULLIF($2, '')::uuid, $3)
    `, orderID, adminID, map[string]any{
		"return_id":     id,
		"amount_cents":  amount,
		"refund_id":     refundID,
		"refund_to":     req.RefundTo,
		"stripe_refund": stripeRefundID,
	})
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AdminCancel cancels a return (admin can do this from any non-refunded state).
func (h *Handler) AdminCancel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `
        UPDATE returns SET status = 'cancelled', updated_at = now()
        WHERE id = $1 AND status NOT IN ('refunded','cancelled')
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "cancel_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusConflict, "bad_status",
			"cannot cancel a refunded or already-cancelled return")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

// createReturn validates the requested line items and inserts the return +
// return_line_items in one transaction. Used by both customer and admin flows.
func createReturn(ctx context.Context, db *pgxpool.Pool, req RequestReq, requestedBy string) (*ReturnDTO, error) {
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			return nil, httpErr(http.StatusBadRequest, "quantity must be > 0")
		}
		if it.Reason == "" {
			it.Reason = "other"
		}
		if !validReasons[it.Reason] {
			return nil, httpErr(http.StatusBadRequest, "invalid reason: "+it.Reason)
		}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Validate every line: belongs to the order, and the quantity does not
	// exceed ordered minus already-returned.
	for _, it := range req.Items {
		var ordered, alreadyReturned int
		err := tx.QueryRow(ctx, `
            SELECT oli.quantity,
              COALESCE((SELECT SUM(rli.quantity) FROM return_line_items rli
                        JOIN returns r2 ON r2.id = rli.return_id
                        WHERE rli.order_line_item_id = oli.id
                          AND r2.status NOT IN ('rejected','cancelled')), 0)
            FROM order_line_items oli
            WHERE oli.id = $1 AND oli.order_id = $2
        `, it.OrderLineItemID, req.OrderID).Scan(&ordered, &alreadyReturned)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, httpErr(http.StatusBadRequest, "line item not in order")
			}
			return nil, err
		}
		if it.Quantity > ordered-alreadyReturned {
			return nil, httpErr(http.StatusBadRequest,
				"return quantity exceeds remaining returnable quantity")
		}
	}

	var rID string
	err = tx.QueryRow(ctx, `
        INSERT INTO returns (order_id, customer_note, requested_by)
        VALUES ($1, $2, $3)
        RETURNING id
    `, req.OrderID, req.CustomerNote, requestedBy).Scan(&rID)
	if err != nil {
		return nil, err
	}
	for _, it := range req.Items {
		reason := it.Reason
		if reason == "" {
			reason = "other"
		}
		if _, err := tx.Exec(ctx, `
            INSERT INTO return_line_items (return_id, order_line_item_id, quantity, reason, note)
            VALUES ($1, $2, $3, $4, $5)
        `, rID, it.OrderLineItemID, it.Quantity, reason, it.Note); err != nil {
			return nil, err
		}
	}
	_, _ = tx.Exec(ctx, `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'return_requested', $2)
    `, req.OrderID, map[string]any{"return_id": rID, "requested_by": requestedBy})
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return loadReturn(ctx, db, rID)
}

// transition updates status with a required fromStatus precondition. A
// timestampColumn (like "approved_at") is stamped when non-empty.
func transition(ctx context.Context, db *pgxpool.Pool, id, newStatus, fromStatus, adminNote, tsCol string) error {
	ts := ""
	if tsCol != "" {
		ts = ", " + tsCol + " = now()"
	}
	noteClause := ""
	args := []any{newStatus, fromStatus, id}
	if adminNote != "" {
		args = append(args, adminNote)
		noteClause = ", admin_note = $4"
	}
	q := `UPDATE returns SET status = $1` + ts + noteClause + `, updated_at = now()
          WHERE id = $3 AND status = $2`
	res, err := db.Exec(ctx, q, args...)
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		return httpErr(http.StatusConflict, "return is not in the required state")
	}
	return nil
}

// estimatedRefundCents sums (unit_price × quantity) across the return's lines.
// This is the default amount when the admin doesn't override — it does NOT
// include shipping (Shopify default behaviour).
func estimatedRefundCents(ctx context.Context, db *pgxpool.Pool, returnID string) (int, error) {
	var total int
	err := db.QueryRow(ctx, `
        SELECT COALESCE(SUM(oli.unit_price_cents * rli.quantity), 0)
        FROM return_line_items rli
        JOIN order_line_items oli ON oli.id = rli.order_line_item_id
        WHERE rli.return_id = $1
    `, returnID).Scan(&total)
	return total, err
}

// listReturnsAdmin is like listReturns but takes an orderId filter instead of
// a customerID filter — what the admin UI wants.
func listReturnsAdmin(ctx context.Context, db *pgxpool.Pool, status, orderID string) ([]ReturnDTO, error) {
	where := []string{"1=1"}
	args := []any{}
	next := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if status != "" {
		where = append(where, "r.status = "+next(status))
	}
	if orderID != "" {
		where = append(where, "r.order_id = "+next(orderID))
	}
	return queryReturns(ctx, db, where, args)
}

func listReturns(ctx context.Context, db *pgxpool.Pool, customerID *string, status string) ([]ReturnDTO, error) {
	where := []string{"1=1"}
	args := []any{}
	next := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if customerID != nil {
		where = append(where, "o.customer_id = "+next(*customerID))
	}
	if status != "" {
		where = append(where, "r.status = "+next(status))
	}
	return queryReturns(ctx, db, where, args)
}

func queryReturns(ctx context.Context, db *pgxpool.Pool, where []string, args []any) ([]ReturnDTO, error) {
	sql := `
        SELECT r.id, r.order_id, o.number, r.rma_number, r.status,
               r.customer_note, r.admin_note, r.refund_id,
               r.requested_by, r.requested_at, r.approved_at, r.received_at, r.refunded_at,
               r.created_at, r.updated_at,
               COALESCE(o.currency, 'EUR')
        FROM returns r
        JOIN orders o ON o.id = r.order_id
        WHERE ` + strings.Join(where, " AND ") + `
        ORDER BY r.created_at DESC
        LIMIT 200`
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ReturnDTO{}
	for rows.Next() {
		var d ReturnDTO
		if err := rows.Scan(&d.ID, &d.OrderID, &d.OrderNumber, &d.RMANumber, &d.Status,
			&d.CustomerNote, &d.AdminNote, &d.RefundID,
			&d.RequestedBy, &d.RequestedAt, &d.ApprovedAt, &d.ReceivedAt, &d.RefundedAt,
			&d.CreatedAt, &d.UpdatedAt, &d.Currency); err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	for i := range items {
		lines, err := loadReturnLines(ctx, db, items[i].ID)
		if err != nil {
			return nil, err
		}
		items[i].Items = lines
		items[i].EstimatedCents, _ = estimatedRefundCents(ctx, db, items[i].ID)
	}
	return items, nil
}

func loadReturn(ctx context.Context, db *pgxpool.Pool, id string) (*ReturnDTO, error) {
	var d ReturnDTO
	err := db.QueryRow(ctx, `
        SELECT r.id, r.order_id, o.number, r.rma_number, r.status,
               r.customer_note, r.admin_note, r.refund_id,
               r.requested_by, r.requested_at, r.approved_at, r.received_at, r.refunded_at,
               r.created_at, r.updated_at, COALESCE(o.currency, 'EUR')
        FROM returns r
        JOIN orders o ON o.id = r.order_id
        WHERE r.id = $1
    `, id).Scan(&d.ID, &d.OrderID, &d.OrderNumber, &d.RMANumber, &d.Status,
		&d.CustomerNote, &d.AdminNote, &d.RefundID,
		&d.RequestedBy, &d.RequestedAt, &d.ApprovedAt, &d.ReceivedAt, &d.RefundedAt,
		&d.CreatedAt, &d.UpdatedAt, &d.Currency)
	if err != nil {
		return nil, err
	}
	d.Items, err = loadReturnLines(ctx, db, id)
	if err != nil {
		return nil, err
	}
	d.EstimatedCents, _ = estimatedRefundCents(ctx, db, id)
	return &d, nil
}

func loadReturnLines(ctx context.Context, db *pgxpool.Pool, returnID string) ([]LineDTO, error) {
	rows, err := db.Query(ctx, `
        SELECT rli.id, rli.order_line_item_id, oli.product_title, oli.variant_title,
               oli.sku, oli.unit_price_cents, rli.quantity, rli.reason, rli.note,
               rli.restocked
        FROM return_line_items rli
        JOIN order_line_items oli ON oli.id = rli.order_line_item_id
        WHERE rli.return_id = $1
    `, returnID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []LineDTO{}
	for rows.Next() {
		var l LineDTO
		if err := rows.Scan(&l.ID, &l.OrderLineItemID, &l.ProductTitle, &l.VariantTitle,
			&l.SKU, &l.UnitPriceCents, &l.Quantity, &l.Reason, &l.Note, &l.Restocked); err != nil {
			return nil, err
		}
		items = append(items, l)
	}
	return items, nil
}

// ─── Tiny error helpers ─────────────────────────────────────────────────

type httpError struct {
	status int
	msg    string
}

func (e *httpError) Error() string { return e.msg }

func httpErr(status int, msg string) error { return &httpError{status: status, msg: msg} }

func errCode(err error) int {
	var he *httpError
	if errors.As(err, &he) {
		return he.status
	}
	return http.StatusInternalServerError
}

func uuidString(b [16]byte) string {
	const hex = "0123456789abcdef"
	out := make([]byte, 36)
	j := 0
	for i := 0; i < 16; i++ {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out[j] = '-'
			j++
		}
		out[j] = hex[b[i]>>4]
		out[j+1] = hex[b[i]&0x0f]
		j += 2
	}
	return string(out)
}
