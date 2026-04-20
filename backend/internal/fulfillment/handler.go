// Package fulfillment manages shipments against an order. A fulfillment is a
// single shipment: one carrier, one tracking number, from one location,
// covering one or more line items (fully or partially).
//
// Creating a fulfillment:
//   - validates each line item is part of the order and not already fully fulfilled
//   - decrements on_hand inventory at the chosen location
//   - recomputes the order's fulfillment_status (unfulfilled → partial → fulfilled)
//   - records an order_events row and queues a "shipped" email
//
// Fulfillments can be cancelled; cancelling restocks inventory and rewinds
// the order status.
package fulfillment

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/email"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{db: db, cfg: cfg}
}

// ─── DTOs ───────────────────────────────────────────────────────────────

type LineInput struct {
	OrderLineItemID string `json:"orderLineItemId"`
	Quantity        int    `json:"quantity"`
}

type CreateReq struct {
	LocationID     string      `json:"locationId"`
	Carrier        string      `json:"carrier"`
	TrackingNumber string      `json:"trackingNumber"`
	TrackingURL    string      `json:"trackingUrl"`
	NotifyCustomer bool        `json:"notifyCustomer"`
	Items          []LineInput `json:"items"`
}

type LineDTO struct {
	ID              string `json:"id"`
	OrderLineItemID string `json:"orderLineItemId"`
	ProductTitle    string `json:"productTitle"`
	VariantTitle    string `json:"variantTitle"`
	SKU             string `json:"sku"`
	Quantity        int    `json:"quantity"`
}

type FulfillmentDTO struct {
	ID              string     `json:"id"`
	OrderID         string     `json:"orderId"`
	Number          int        `json:"number"`
	LocationID      *string    `json:"locationId,omitempty"`
	LocationName    string     `json:"locationName,omitempty"`
	Carrier         string     `json:"carrier"`
	TrackingNumber  string     `json:"trackingNumber"`
	TrackingURL     string     `json:"trackingUrl"`
	Status          string     `json:"status"`
	ShippedAt       *time.Time `json:"shippedAt,omitempty"`
	DeliveredAt     *time.Time `json:"deliveredAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	Items           []LineDTO  `json:"items"`
}

// ─── Handlers ───────────────────────────────────────────────────────────

// ListForOrder returns all fulfillments for an order, newest first.
func (h *Handler) ListForOrder(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	rows, err := h.db.Query(r.Context(), `
        SELECT f.id, f.order_id, f.number, f.location_id,
               COALESCE(l.name, ''), f.carrier, f.tracking_number, f.tracking_url,
               f.status, f.shipped_at, f.delivered_at, f.created_at
        FROM fulfillments f
        LEFT JOIN locations l ON l.id = f.location_id
        WHERE f.order_id = $1
        ORDER BY f.number DESC
    `, orderID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []FulfillmentDTO{}
	for rows.Next() {
		var f FulfillmentDTO
		if err := rows.Scan(&f.ID, &f.OrderID, &f.Number, &f.LocationID, &f.LocationName,
			&f.Carrier, &f.TrackingNumber, &f.TrackingURL,
			&f.Status, &f.ShippedAt, &f.DeliveredAt, &f.CreatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, f)
	}
	for i := range items {
		ls, err := loadFulfillmentLines(r.Context(), h.db, items[i].ID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "lines_error", err.Error())
			return
		}
		items[i].Items = ls
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// Create ships one or more line items off an order.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	orderID := chi.URLParam(r, "id")
	var req CreateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if len(req.Items) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty", "at least one item required")
		return
	}
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			httpx.Error(w, http.StatusBadRequest, "invalid_qty", "quantity must be > 0")
			return
		}
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// Verify the order exists and lock it.
	var orderNumber, orderEmail, fulfillmentStatus string
	if err := tx.QueryRow(r.Context(),
		`SELECT number, email, fulfillment_status FROM orders WHERE id = $1 FOR UPDATE`,
		orderID,
	).Scan(&orderNumber, &orderEmail, &fulfillmentStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "order_error", err.Error())
		return
	}

	// Validate each line: belongs to this order, and the requested quantity
	// doesn't exceed what's left to fulfill.
	for _, it := range req.Items {
		var ordered, alreadyFulfilled int
		var variantID *string
		err := tx.QueryRow(r.Context(), `
            SELECT oli.quantity, oli.variant_id,
              COALESCE((SELECT SUM(fli.quantity) FROM fulfillment_line_items fli
                        JOIN fulfillments f ON f.id = fli.fulfillment_id
                        WHERE fli.order_line_item_id = oli.id AND f.status <> 'cancelled'), 0)
            FROM order_line_items oli
            WHERE oli.id = $1 AND oli.order_id = $2
        `, it.OrderLineItemID, orderID).Scan(&ordered, &variantID, &alreadyFulfilled)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, http.StatusBadRequest, "line_not_in_order",
					"line item does not belong to this order")
				return
			}
			httpx.Error(w, http.StatusInternalServerError, "line_error", err.Error())
			return
		}
		remaining := ordered - alreadyFulfilled
		if it.Quantity > remaining {
			httpx.Error(w, http.StatusBadRequest, "over_fulfill",
				"cannot fulfill more than what's left on the line")
			return
		}
	}

	// Compute next fulfillment number for this order.
	var nextNumber int
	_ = tx.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(number), 0) + 1 FROM fulfillments WHERE order_id = $1`, orderID,
	).Scan(&nextNumber)

	// Insert the fulfillment row.
	var locationID *string
	if strings.TrimSpace(req.LocationID) != "" {
		l := req.LocationID
		locationID = &l
	}
	var fID string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO fulfillments (order_id, location_id, number, carrier,
                                  tracking_number, tracking_url, shipped_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        RETURNING id
    `, orderID, locationID, nextNumber, req.Carrier, req.TrackingNumber, req.TrackingURL,
	).Scan(&fID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	// Insert line items + decrement inventory where we have a location.
	sess, _ := auth.SessionFromContext(r.Context())
	for _, it := range req.Items {
		if _, err := tx.Exec(r.Context(), `
            INSERT INTO fulfillment_line_items (fulfillment_id, order_line_item_id, quantity)
            VALUES ($1, $2, $3)
        `, fID, it.OrderLineItemID, it.Quantity); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "line_insert", err.Error())
			return
		}
		if locationID != nil {
			// Look up variant_id for the inventory decrement.
			var variantID *string
			_ = tx.QueryRow(r.Context(),
				`SELECT variant_id FROM order_line_items WHERE id = $1`, it.OrderLineItemID,
			).Scan(&variantID)
			if variantID != nil {
				if _, err := tx.Exec(r.Context(), `
                    INSERT INTO inventory_levels (variant_id, location_id, on_hand, updated_at)
                    VALUES ($1, $2, 0, now())
                    ON CONFLICT (variant_id, location_id)
                    DO UPDATE SET on_hand = GREATEST(inventory_levels.on_hand - $3, 0), updated_at = now()
                `, *variantID, *locationID, it.Quantity); err != nil {
					httpx.Error(w, http.StatusInternalServerError, "inv_update", err.Error())
					return
				}
				adminID := ""
				if sess != nil && sess.UserID.Valid {
					adminID = uuidString(sess.UserID.Bytes)
				}
				if _, err := tx.Exec(r.Context(), `
                    INSERT INTO inventory_adjustments (variant_id, location_id, delta, reason, note, admin_id)
                    VALUES ($1, $2, $3, 'fulfillment', $4, NULLIF($5, '')::uuid)
                `, *variantID, *locationID, -it.Quantity,
					"Fulfillment #"+orderNumber+"-"+iToString(nextNumber), adminID); err != nil {
					httpx.Error(w, http.StatusInternalServerError, "adj_error", err.Error())
					return
				}
			}
		}
	}

	// Update order fulfillment_status.
	newStatus, err := computeOrderFulfillmentStatus(r.Context(), tx, orderID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "status_compute", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE orders SET fulfillment_status = $1, updated_at = now() WHERE id = $2`,
		newStatus, orderID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "status_update", err.Error())
		return
	}

	// Timeline entry.
	_, _ = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'fulfilled', $2)
    `, orderID, map[string]any{
		"fulfillment_id":  fID,
		"number":          nextNumber,
		"carrier":         req.Carrier,
		"tracking_number": req.TrackingNumber,
	})

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	// Queue the shipment email. Failure here must not roll back the fulfillment.
	if req.NotifyCustomer && orderEmail != "" && h.cfg != nil {
		go sendShippedEmail(h.cfg, orderEmail, orderNumber, req.Carrier, req.TrackingNumber, req.TrackingURL)
	}

	// Return the full DTO.
	dto, err := loadFulfillmentDTO(r.Context(), h.db, fID)
	if err != nil {
		httpx.JSON(w, http.StatusCreated, map[string]string{"id": fID})
		return
	}
	httpx.JSON(w, http.StatusCreated, dto)
}

type UpdateTrackingReq struct {
	Carrier        string `json:"carrier"`
	TrackingNumber string `json:"trackingNumber"`
	TrackingURL    string `json:"trackingUrl"`
}

// UpdateTracking edits carrier/tracking fields on a fulfillment after the fact.
func (h *Handler) UpdateTracking(w http.ResponseWriter, r *http.Request) {
	fID := chi.URLParam(r, "fulfillmentId")
	var req UpdateTrackingReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	res, err := h.db.Exec(r.Context(), `
        UPDATE fulfillments SET carrier = $1, tracking_number = $2, tracking_url = $3, updated_at = now()
        WHERE id = $4
    `, req.Carrier, req.TrackingNumber, req.TrackingURL, fID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "fulfillment not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Cancel marks a fulfillment cancelled and restocks inventory. Used when a
// shipment was created in error (wrong carrier, wrong address, etc.).
func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	fID := chi.URLParam(r, "fulfillmentId")

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var orderID, status string
	var locationID *string
	if err := tx.QueryRow(r.Context(),
		`SELECT order_id, status, location_id FROM fulfillments WHERE id = $1 FOR UPDATE`, fID,
	).Scan(&orderID, &status, &locationID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "fulfillment not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if status == "cancelled" {
		httpx.Error(w, http.StatusConflict, "already_cancelled", "already cancelled")
		return
	}

	// Restock each line.
	sess, _ := auth.SessionFromContext(r.Context())
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID.Bytes)
	}
	if locationID != nil {
		rows, err := tx.Query(r.Context(), `
            SELECT oli.variant_id, fli.quantity
            FROM fulfillment_line_items fli
            JOIN order_line_items oli ON oli.id = fli.order_line_item_id
            WHERE fli.fulfillment_id = $1
        `, fID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "lines_error", err.Error())
			return
		}
		type restockItem struct {
			variantID *string
			qty       int
		}
		var items []restockItem
		for rows.Next() {
			var vID *string
			var q int
			if err := rows.Scan(&vID, &q); err != nil {
				rows.Close()
				httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
				return
			}
			items = append(items, restockItem{variantID: vID, qty: q})
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
            `, *it.variantID, *locationID, it.qty); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "restock_error", err.Error())
				return
			}
			if _, err := tx.Exec(r.Context(), `
                INSERT INTO inventory_adjustments (variant_id, location_id, delta, reason, note, admin_id)
                VALUES ($1, $2, $3, 'return_restock', 'Fulfillment cancelled', NULLIF($4, '')::uuid)
            `, *it.variantID, *locationID, it.qty, adminID); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "adj_error", err.Error())
				return
			}
		}
	}

	if _, err := tx.Exec(r.Context(),
		`UPDATE fulfillments SET status = 'cancelled', updated_at = now() WHERE id = $1`, fID,
	); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}

	// Recompute order status now that this shipment's lines no longer count.
	newStatus, err := computeOrderFulfillmentStatus(r.Context(), tx, orderID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "status_compute", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE orders SET fulfillment_status = $1, updated_at = now() WHERE id = $2`,
		newStatus, orderID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "status_update", err.Error())
		return
	}

	_, _ = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'fulfillment_cancelled', $2)
    `, orderID, map[string]any{"fulfillment_id": fID})

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

// computeOrderFulfillmentStatus sums fulfilled quantities across non-cancelled
// fulfillments and compares against total ordered quantity.
//
// Returns one of: 'unfulfilled', 'partial', 'fulfilled' (matches the enum
// values defined in 00003_orders.sql).
func computeOrderFulfillmentStatus(ctx context.Context, tx pgx.Tx, orderID string) (string, error) {
	var ordered, fulfilled int
	err := tx.QueryRow(ctx, `
        SELECT
          COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = $1), 0),
          COALESCE((SELECT SUM(fli.quantity)
                    FROM fulfillment_line_items fli
                    JOIN fulfillments f ON f.id = fli.fulfillment_id
                    WHERE f.order_id = $1 AND f.status <> 'cancelled'), 0)
    `, orderID).Scan(&ordered, &fulfilled)
	if err != nil {
		return "", err
	}
	switch {
	case fulfilled == 0:
		return "unfulfilled", nil
	case fulfilled >= ordered:
		return "fulfilled", nil
	default:
		return "partial", nil
	}
}

func loadFulfillmentLines(ctx context.Context, db *pgxpool.Pool, fID string) ([]LineDTO, error) {
	rows, err := db.Query(ctx, `
        SELECT fli.id, fli.order_line_item_id, oli.product_title, oli.variant_title,
               oli.sku, fli.quantity
        FROM fulfillment_line_items fli
        JOIN order_line_items oli ON oli.id = fli.order_line_item_id
        WHERE fli.fulfillment_id = $1
    `, fID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []LineDTO{}
	for rows.Next() {
		var l LineDTO
		if err := rows.Scan(&l.ID, &l.OrderLineItemID, &l.ProductTitle, &l.VariantTitle,
			&l.SKU, &l.Quantity); err != nil {
			return nil, err
		}
		items = append(items, l)
	}
	return items, nil
}

func loadFulfillmentDTO(ctx context.Context, db *pgxpool.Pool, fID string) (*FulfillmentDTO, error) {
	var f FulfillmentDTO
	err := db.QueryRow(ctx, `
        SELECT f.id, f.order_id, f.number, f.location_id,
               COALESCE(l.name, ''), f.carrier, f.tracking_number, f.tracking_url,
               f.status, f.shipped_at, f.delivered_at, f.created_at
        FROM fulfillments f
        LEFT JOIN locations l ON l.id = f.location_id
        WHERE f.id = $1
    `, fID).Scan(&f.ID, &f.OrderID, &f.Number, &f.LocationID, &f.LocationName,
		&f.Carrier, &f.TrackingNumber, &f.TrackingURL,
		&f.Status, &f.ShippedAt, &f.DeliveredAt, &f.CreatedAt)
	if err != nil {
		return nil, err
	}
	f.Items, err = loadFulfillmentLines(ctx, db, fID)
	if err != nil {
		return nil, err
	}
	return &f, nil
}

func sendShippedEmail(cfg *config.Config, to, orderNumber, carrier, tracking, trackingURL string) {
	sender := email.New(cfg)
	_ = sender.Send(email.Message{
		To:      to,
		Subject: "Your order " + orderNumber + " has shipped — " + cfg.ShopName,
		HTML:    renderShippedHTML(cfg.ShopName, orderNumber, carrier, tracking, trackingURL),
	})
}

func renderShippedHTML(shopName, orderNumber, carrier, tracking, trackingURL string) string {
	esc := func(s string) string {
		return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
	}
	trackBlock := ""
	if tracking != "" {
		t := `<p style="margin:8px 0 0 0;"><b>Tracking:</b> ` + esc(tracking) + `</p>`
		if trackingURL != "" {
			t += `<p style="text-align:center;margin:16px 0;">
          <a href="` + esc(trackingURL) + `" style="display:inline-block;padding:10px 20px;border-radius:6px;background:#0a0a0a;color:#fff;text-decoration:none;">Track your package</a></p>`
		}
		trackBlock = t
	}
	carrierLine := ""
	if carrier != "" {
		carrierLine = `<p style="margin:0;"><b>Carrier:</b> ` + esc(carrier) + `</p>`
	}
	return `<!doctype html><html><body style="margin:0;padding:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f6f7;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 8px 0;font-size:22px;">Your order is on its way</h1>
    <p style="margin:0 0 16px 0;color:#4b5563;">Order ` + esc(orderNumber) + ` has shipped.</p>
    ` + carrierLine + `
    ` + trackBlock + `
  </div>
  <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">© ` + esc(shopName) + `</p>
</div>
</body></html>`
}

func iToString(i int) string {
	// Avoid importing strconv just for this; keeps dependencies minimal.
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var digits [20]byte
	n := 0
	for i > 0 {
		digits[n] = byte('0' + i%10)
		i /= 10
		n++
	}
	if neg {
		digits[n] = '-'
		n++
	}
	out := make([]byte, n)
	for j := 0; j < n; j++ {
		out[j] = digits[n-1-j]
	}
	return string(out)
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
