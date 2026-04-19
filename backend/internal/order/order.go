package order

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── List ────────────────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	where := []string{"TRUE"}
	args := []any{limit + 1}
	addArg := func(v any) int { args = append(args, v); return len(args) }

	if s := q.Get("status"); s != "" {
		i := addArg(s)
		where = append(where, "o.status = $"+strconv.Itoa(i))
	}
	if fs := q.Get("financialStatus"); fs != "" {
		i := addArg(fs)
		where = append(where, "o.financial_status = $"+strconv.Itoa(i))
	}
	if ff := q.Get("fulfillmentStatus"); ff != "" {
		i := addArg(ff)
		where = append(where, "o.fulfillment_status = $"+strconv.Itoa(i))
	}
	if search := strings.TrimSpace(q.Get("q")); search != "" {
		i := addArg("%" + search + "%")
		n := strconv.Itoa(i)
		where = append(where, "(o.email ILIKE $"+n+" OR o.number ILIKE $"+n+")")
	}
	if cursor := q.Get("cursor"); cursor != "" {
		if ts, id, ok := decodeCursor(cursor); ok {
			i1 := addArg(ts)
			i2 := addArg(id)
			where = append(where, "(o.created_at, o.id) < ($"+strconv.Itoa(i1)+", $"+strconv.Itoa(i2)+")")
		}
	}

	sql := `
        SELECT o.id, o.number, o.email,
               COALESCE((SELECT first_name || ' ' || last_name FROM order_addresses WHERE order_id = o.id AND kind = 'shipping'), '') AS cust_name,
               o.status, o.financial_status, o.fulfillment_status,
               o.total_cents, o.currency, o.created_at,
               COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = o.id), 0) AS items_count
        FROM orders o
        WHERE ` + strings.Join(where, " AND ") + `
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT $1
    `
	rows, err := h.db.Query(r.Context(), sql, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := &ListPage{Items: []ListItem{}}
	var last ListItem
	n := 0
	for rows.Next() {
		var it ListItem
		if err := rows.Scan(&it.ID, &it.Number, &it.Email, &it.CustomerName,
			&it.Status, &it.FinancialStatus, &it.FulfillmentStatus,
			&it.TotalCents, &it.Currency, &it.CreatedAt, &it.ItemsCount); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		n++
		if n <= limit {
			out.Items = append(out.Items, it)
			last = it
		}
	}
	if n > limit {
		out.NextCursor = encodeCursor(last.CreatedAt, last.ID)
	}

	// Total count (cheap enough on an indexed table).
	_ = h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM orders`).Scan(&out.Total)

	httpx.JSON(w, http.StatusOK, out)
}

// ─── Get (detail) ────────────────────────────────────────────────────────

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	o, err := h.load(r.Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, o)
}

func (h *Handler) load(ctx context.Context, id string) (*Order, error) {
	o := &Order{Tags: []string{}, LineItems: []LineItem{}, Payments: []Payment{}, Events: []Event{}}
	var customerID *string
	err := h.db.QueryRow(ctx, `
        SELECT id, number, customer_id, email, phone, currency,
               status, financial_status, fulfillment_status,
               subtotal_cents, discount_cents, tax_cents, shipping_cents, total_cents,
               note, created_at, updated_at, paid_at, cancelled_at, fulfilled_at,
               COALESCE((SELECT first_name || ' ' || last_name FROM order_addresses WHERE order_id = orders.id AND kind = 'shipping'), '') AS name
        FROM orders WHERE id = $1
    `, id).Scan(&o.ID, &o.Number, &customerID, &o.Email, &o.Phone, &o.Currency,
		&o.Status, &o.FinancialStatus, &o.FulfillmentStatus,
		&o.SubtotalCents, &o.DiscountCents, &o.TaxCents, &o.ShippingCents, &o.TotalCents,
		&o.Note, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt, &o.CancelledAt, &o.FulfilledAt,
		&o.CustomerName)
	if err != nil {
		return nil, err
	}
	o.CustomerID = customerID

	// Tags
	rows, err := h.db.Query(ctx, `SELECT tag FROM order_tags WHERE order_id = $1 ORDER BY tag`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return nil, err
		}
		o.Tags = append(o.Tags, t)
	}
	rows.Close()

	// Line items
	rows, err = h.db.Query(ctx, `
        SELECT id, variant_id, product_id, product_title, variant_title, sku, image_url,
               unit_price_cents, quantity, discount_cents, tax_cents, total_cents
        FROM order_line_items WHERE order_id = $1 ORDER BY created_at
    `, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var li LineItem
		var vid, pid pgtype.UUID
		if err := rows.Scan(&li.ID, &vid, &pid, &li.ProductTitle, &li.VariantTitle, &li.SKU, &li.ImageURL,
			&li.UnitPriceCents, &li.Quantity, &li.DiscountCents, &li.TaxCents, &li.TotalCents); err != nil {
			rows.Close()
			return nil, err
		}
		if vid.Valid {
			s := uuidString(vid.Bytes)
			li.VariantID = &s
		}
		if pid.Valid {
			s := uuidString(pid.Bytes)
			li.ProductID = &s
		}
		o.LineItems = append(o.LineItems, li)
	}
	rows.Close()

	// Addresses
	rows, err = h.db.Query(ctx, `
        SELECT kind, first_name, last_name, company, address_line1, address_line2,
               city, region, postal_code, country, phone
        FROM order_addresses WHERE order_id = $1
    `, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var kind string
		var a Address
		if err := rows.Scan(&kind, &a.FirstName, &a.LastName, &a.Company,
			&a.AddressLine1, &a.AddressLine2, &a.City, &a.Region, &a.PostalCode,
			&a.Country, &a.Phone); err != nil {
			rows.Close()
			return nil, err
		}
		if kind == "shipping" {
			o.ShippingAddress = &a
		} else {
			o.BillingAddress = &a
		}
	}
	rows.Close()

	// Payments
	rows, err = h.db.Query(ctx, `
        SELECT id, provider, COALESCE(provider_ref, ''), status, amount_cents, currency, brand, last4, created_at
        FROM payments WHERE order_id = $1 ORDER BY created_at
    `, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p Payment
		if err := rows.Scan(&p.ID, &p.Provider, &p.ProviderRef, &p.Status, &p.AmountCents,
			&p.Currency, &p.Brand, &p.Last4, &p.CreatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		o.Payments = append(o.Payments, p)
	}
	rows.Close()

	// Refund total
	_ = h.db.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_cents), 0) FROM refunds WHERE order_id = $1`, id,
	).Scan(&o.TotalRefundedCents)

	// Events (timeline)
	rows, err = h.db.Query(ctx, `
        SELECT id, kind, admin_id, payload, created_at
        FROM order_events WHERE order_id = $1 ORDER BY created_at DESC LIMIT 50
    `, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e Event
		var adminID pgtype.UUID
		var payloadRaw []byte
		if err := rows.Scan(&e.ID, &e.Kind, &adminID, &payloadRaw, &e.CreatedAt); err != nil {
			return nil, err
		}
		if adminID.Valid {
			s := uuidString(adminID.Bytes)
			e.AdminID = &s
		}
		if len(payloadRaw) > 0 {
			_ = json.Unmarshal(payloadRaw, &e.Payload)
		}
		o.Events = append(o.Events, e)
	}
	return o, nil
}

// ─── Cancel ──────────────────────────────────────────────────────────────

func (h *Handler) Cancel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var status, financialStatus string
	err = tx.QueryRow(r.Context(),
		`SELECT status, financial_status FROM orders WHERE id = $1 FOR UPDATE`, id,
	).Scan(&status, &financialStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if status == "cancelled" {
		httpx.Error(w, http.StatusConflict, "already_cancelled", "order is already cancelled")
		return
	}
	if financialStatus == "paid" || financialStatus == "partially_paid" {
		httpx.Error(w, http.StatusConflict, "paid_needs_refund",
			"paid orders must be refunded before cancelling (see refund endpoint)")
		return
	}

	_, err = tx.Exec(r.Context(),
		`UPDATE orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID.Bytes)
	}
	_, err = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, admin_id, payload)
        VALUES ($1, 'cancelled', NULLIF($2, '')::uuid, $3)
    `, id, adminID, map[string]any{"at": time.Now().UTC()})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "event_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	o, err := h.load(r.Context(), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, o)
}

// ─── Note + tags ─────────────────────────────────────────────────────────

type NoteReq struct {
	Note string `json:"note"`
}

func (h *Handler) SetNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())
	var req NoteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	_, err := h.db.Exec(r.Context(),
		`UPDATE orders SET note = $1, updated_at = now() WHERE id = $2`, req.Note, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID.Bytes)
	}
	_, _ = h.db.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, admin_id, payload)
        VALUES ($1, 'note_added', NULLIF($2, '')::uuid, $3)
    `, id, adminID, map[string]any{"note": req.Note})
	o, err := h.load(r.Context(), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, o)
}

type TagsReq struct {
	Tags []string `json:"tags"`
}

func (h *Handler) SetTags(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req TagsReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	if _, err := tx.Exec(r.Context(), `DELETE FROM order_tags WHERE order_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_error", err.Error())
		return
	}
	seen := map[string]struct{}{}
	for _, t := range req.Tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO order_tags (order_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			id, t); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	o, err := h.load(r.Context(), id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, o)
}

// ─── helpers ─────────────────────────────────────────────────────────────

func encodeCursor(t time.Time, id string) string {
	return t.Format(time.RFC3339Nano) + "|" + id
}
func decodeCursor(s string) (time.Time, string, bool) {
	i := strings.LastIndex(s, "|")
	if i < 0 {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, s[:i])
	if err != nil {
		return time.Time{}, "", false
	}
	return t, s[i+1:], true
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
