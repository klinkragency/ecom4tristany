package customer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/email"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ─── Admin list view ────────────────────────────────────────────────────

type AdminListItem struct {
	ID             string    `json:"id"`
	Email          string    `json:"email"`
	FirstName      string    `json:"firstName"`
	LastName       string    `json:"lastName"`
	Phone          string    `json:"phone"`
	OrderCount     int       `json:"orderCount"`
	TotalSpentCents int      `json:"totalSpentCents"`
	Currency       string    `json:"currency"`
	LastOrderAt    *time.Time `json:"lastOrderAt,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	Tags           []string  `json:"tags"`
}

type AdminListPage struct {
	Items []AdminListItem `json:"items"`
	Total int             `json:"total"`
}

func (h *Handler) AdminList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 100 {
		limit = 25
	}

	where := []string{"TRUE"}
	args := []any{limit}
	addArg := func(v any) int { args = append(args, v); return len(args) }

	if s := strings.TrimSpace(q.Get("q")); s != "" {
		i := addArg("%" + s + "%")
		n := strconv.Itoa(i)
		where = append(where, "(c.email ILIKE $"+n+" OR c.first_name ILIKE $"+n+" OR c.last_name ILIKE $"+n+")")
	}

	sql := `
        SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.created_at,
               COALESCE((SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS oc,
               COALESCE((SELECT SUM(total_cents) - COALESCE((SELECT SUM(amount_cents) FROM refunds r JOIN orders o2 ON o2.id = r.order_id WHERE o2.customer_id = c.id), 0)
                         FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS spent,
               'EUR' AS currency,
               (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) AS last_order_at
        FROM customers c
        WHERE ` + strings.Join(where, " AND ") + `
        ORDER BY c.created_at DESC
        LIMIT $1
    `
	rows, err := h.db.Query(r.Context(), sql, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := &AdminListPage{Items: []AdminListItem{}}
	for rows.Next() {
		var it AdminListItem
		if err := rows.Scan(&it.ID, &it.Email, &it.FirstName, &it.LastName, &it.Phone,
			&it.CreatedAt, &it.OrderCount, &it.TotalSpentCents, &it.Currency, &it.LastOrderAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		// fetch tags per row — cheap since there's usually <100 per customer.
		trows, _ := h.db.Query(r.Context(), `SELECT tag FROM customer_tags WHERE customer_id = $1 ORDER BY tag`, it.ID)
		for trows.Next() {
			var t string
			if err := trows.Scan(&t); err == nil {
				it.Tags = append(it.Tags, t)
			}
		}
		trows.Close()
		if it.Tags == nil {
			it.Tags = []string{}
		}
		out.Items = append(out.Items, it)
	}
	_ = h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM customers`).Scan(&out.Total)
	httpx.JSON(w, http.StatusOK, out)
}

// ─── Admin detail view ──────────────────────────────────────────────────

type AdminDetail struct {
	ID                 string          `json:"id"`
	Email              string          `json:"email"`
	FirstName          string          `json:"firstName"`
	LastName           string          `json:"lastName"`
	Phone              string          `json:"phone"`
	MarketingConsent   bool            `json:"marketingConsent"`
	Note               string          `json:"note"`
	Tags               []string        `json:"tags"`
	CreatedAt          time.Time       `json:"createdAt"`
	UpdatedAt          time.Time       `json:"updatedAt"`
	OrderCount         int             `json:"orderCount"`
	TotalSpentCents    int             `json:"totalSpentCents"`
	AvgOrderCents      int             `json:"avgOrderCents"`
	LastOrderAt        *time.Time      `json:"lastOrderAt,omitempty"`
	StoreCreditCents   int             `json:"storeCreditCents"`
	StoreCreditCurrency string         `json:"storeCreditCurrency"`
	Addresses          []Address       `json:"addresses"`
	RecentOrders       []OrderListItem `json:"recentOrders"`
	LedgerEntries      []LedgerEntry   `json:"ledgerEntries"`
}

func (h *Handler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var d AdminDetail
	err := h.db.QueryRow(r.Context(), `
        SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.marketing_consent,
               c.note, c.created_at, c.updated_at,
               COALESCE((SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS oc,
               COALESCE((SELECT SUM(total_cents) FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS spent,
               (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) AS last_order_at,
               COALESCE((SELECT balance_cents FROM store_credit_accounts WHERE customer_id = c.id), 0) AS sc_balance,
               COALESCE((SELECT currency FROM store_credit_accounts WHERE customer_id = c.id), 'EUR') AS sc_currency
        FROM customers c WHERE c.id = $1
    `, id).Scan(&d.ID, &d.Email, &d.FirstName, &d.LastName, &d.Phone, &d.MarketingConsent,
		&d.Note, &d.CreatedAt, &d.UpdatedAt,
		&d.OrderCount, &d.TotalSpentCents, &d.LastOrderAt,
		&d.StoreCreditCents, &d.StoreCreditCurrency)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "customer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if d.OrderCount > 0 {
		d.AvgOrderCents = d.TotalSpentCents / d.OrderCount
	}

	// Tags
	trows, _ := h.db.Query(r.Context(), `SELECT tag FROM customer_tags WHERE customer_id = $1 ORDER BY tag`, id)
	d.Tags = []string{}
	for trows.Next() {
		var t string
		if err := trows.Scan(&t); err == nil {
			d.Tags = append(d.Tags, t)
		}
	}
	trows.Close()

	// Addresses
	arows, err := h.db.Query(r.Context(), `
        SELECT id, label, first_name, last_name, company, address_line1, address_line2,
               city, region, postal_code, country, phone, is_default_shipping, is_default_billing
        FROM customer_addresses WHERE customer_id = $1
        ORDER BY is_default_shipping DESC, is_default_billing DESC, created_at
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "addresses_error", err.Error())
		return
	}
	d.Addresses = []Address{}
	for arows.Next() {
		var a Address
		if err := arows.Scan(&a.ID, &a.Label, &a.FirstName, &a.LastName, &a.Company,
			&a.AddressLine1, &a.AddressLine2, &a.City, &a.Region, &a.PostalCode,
			&a.Country, &a.Phone, &a.IsDefaultShipping, &a.IsDefaultBilling); err != nil {
			arows.Close()
			httpx.Error(w, http.StatusInternalServerError, "address_scan", err.Error())
			return
		}
		d.Addresses = append(d.Addresses, a)
	}
	arows.Close()

	// Recent orders (up to 10)
	orows, err := h.db.Query(r.Context(), `
        SELECT id, number, status, financial_status, fulfillment_status,
               total_cents, currency, created_at,
               COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = o.id), 0)
        FROM orders o WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 10
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "orders_error", err.Error())
		return
	}
	d.RecentOrders = []OrderListItem{}
	for orows.Next() {
		var o OrderListItem
		if err := orows.Scan(&o.ID, &o.Number, &o.Status, &o.FinancialStatus, &o.FulfillmentStatus,
			&o.TotalCents, &o.Currency, &o.CreatedAt, &o.ItemsCount); err != nil {
			orows.Close()
			httpx.Error(w, http.StatusInternalServerError, "order_scan", err.Error())
			return
		}
		d.RecentOrders = append(d.RecentOrders, o)
	}
	orows.Close()

	// Store credit ledger (last 20)
	lrows, err := h.db.Query(r.Context(), `
        SELECT id, delta_cents, reason, note, order_id, created_at
        FROM store_credit_ledger WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 20
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ledger_error", err.Error())
		return
	}
	d.LedgerEntries = []LedgerEntry{}
	for lrows.Next() {
		var e LedgerEntry
		var oid *string
		if err := lrows.Scan(&e.ID, &e.DeltaCents, &e.Reason, &e.Note, &oid, &e.CreatedAt); err != nil {
			lrows.Close()
			httpx.Error(w, http.StatusInternalServerError, "ledger_scan", err.Error())
			return
		}
		e.OrderID = oid
		d.LedgerEntries = append(d.LedgerEntries, e)
	}
	lrows.Close()

	httpx.JSON(w, http.StatusOK, d)
}

// ─── Admin actions ──────────────────────────────────────────────────────

type NoteReq struct {
	Note string `json:"note"`
}

func (h *Handler) AdminSetNote(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req NoteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if _, err := h.db.Exec(r.Context(),
		`UPDATE customers SET note = $1, updated_at = now() WHERE id = $2`, req.Note, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type TagsReq struct {
	Tags []string `json:"tags"`
}

func (h *Handler) AdminSetTags(w http.ResponseWriter, r *http.Request) {
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
	if _, err := tx.Exec(r.Context(), `DELETE FROM customer_tags WHERE customer_id = $1`, id); err != nil {
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
			`INSERT INTO customer_tags (customer_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			id, t); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type GrantCreditReq struct {
	AmountCents int    `json:"amountCents"`
	Reason      string `json:"reason"` // grant / adjustment / promotional / refund / expiration
	Note        string `json:"note"`
}

// AdminGrantCredit adds (or removes) store credit. Positive amount = grant,
// negative = debit. The trigger on the ledger keeps `balance_cents` in sync
// and refuses to go negative.
func (h *Handler) AdminGrantCredit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())

	var req GrantCreditReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.AmountCents == 0 {
		httpx.Error(w, http.StatusBadRequest, "zero", "amount must be non-zero")
		return
	}
	if req.Reason == "" {
		req.Reason = "grant"
	}
	validReasons := map[string]bool{
		"grant": true, "refund": true, "purchase": true,
		"adjustment": true, "expiration": true, "promotional": true,
	}
	if !validReasons[req.Reason] {
		httpx.Error(w, http.StatusBadRequest, "invalid_reason", "invalid reason")
		return
	}
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID)
	}
	_, err := h.db.Exec(r.Context(), `
        INSERT INTO store_credit_ledger (customer_id, delta_cents, reason, note, admin_id)
        VALUES ($1, $2, $3, $4, NULLIF($5, '')::uuid)
    `, id, req.AmountCents, req.Reason, req.Note, adminID)
	if err != nil {
		// Negative-balance guard from the trigger bubbles up as a generic error.
		httpx.Error(w, http.StatusConflict, "ledger_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Admin create ──────────────────────────────────────────────────────

type AdminCreateReq struct {
	Email      string `json:"email"`
	FirstName  string `json:"firstName"`
	LastName   string `json:"lastName"`
	Phone      string `json:"phone"`
	SendInvite bool   `json:"sendInvite"`
}

type AdminCreateResp struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	FirstName  string `json:"firstName"`
	LastName   string `json:"lastName"`
	Phone      string `json:"phone"`
	InviteSent bool   `json:"inviteSent"`
}

// AdminCreate adds a customer record from the admin panel. The customer has
// no usable password — we hash 32 random bytes so the row satisfies the
// NOT-NULL constraint but no one can ever log in with it. If the customer
// later wants to access their account, they go through the public password
// reset flow (which only requires the email).
func (h *Handler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var req AdminCreateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	req.Phone = strings.TrimSpace(req.Phone)
	if req.Email == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_email", "email is required")
		return
	}
	if !strings.Contains(req.Email, "@") {
		httpx.Error(w, http.StatusBadRequest, "invalid_email", "email looks invalid")
		return
	}

	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "rand_error", "could not generate password seed")
		return
	}
	hash, err := auth.HashPassword(base64.StdEncoding.EncodeToString(raw[:]))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", "could not hash placeholder password")
		return
	}

	var id string
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO customers (email, password_hash, first_name, last_name, phone)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id::text
    `, req.Email, hash, req.FirstName, req.LastName, req.Phone).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, http.StatusConflict, "email_taken", "a customer with that email already exists")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	inviteSent := false
	if req.SendInvite {
		if err := h.sendInviteEmail(r.Context(), id, req.Email, req.FirstName, req.LastName, clientIPFromRequest(r), r.UserAgent()); err != nil {
			// Don't fail the create — the customer record is good. Log on
			// stderr so the admin can retry by hitting "Resend" later.
			fmt.Println("invite email send failed:", err)
		} else {
			inviteSent = true
		}
	}

	httpx.JSON(w, http.StatusCreated, AdminCreateResp{
		ID:         id,
		Email:      req.Email,
		FirstName:  req.FirstName,
		LastName:   req.LastName,
		Phone:      req.Phone,
		InviteSent: inviteSent,
	})
}

// sendInviteEmail generates a password-reset token (TTL = resetTTL, same as
// the public reset flow) and emails the customer a "set your password" link.
// Internally it reuses the customer_password_resets table.
func (h *Handler) sendInviteEmail(ctx context.Context, customerID, em, first, last, ip, ua string) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	secret := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	tokenHash := hex.EncodeToString(sum[:])

	if _, err := h.db.Exec(ctx, `
        INSERT INTO customer_password_resets (customer_id, token_hash, expires_at, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5)
    `, customerID, tokenHash, time.Now().Add(resetTTL), ip, ua); err != nil {
		return err
	}

	if h.cfg == nil {
		// No email config wired (admin handler was constructed via NewHandler
		// without cfg). Skip the email but the token is still valid — the
		// admin can resend later.
		return nil
	}

	resetURL := fmt.Sprintf("%s/account/password-reset/confirm?token=%s",
		strings.TrimRight(h.cfg.ShopPublicURL, "/"), secret)
	sender := email.New(h.cfg)
	name := strings.TrimSpace(first + " " + last)
	if name == "" {
		name = em
	}
	return sender.Send(email.Message{
		To:      em,
		Subject: "Welcome to " + h.cfg.ShopName + " — set your password",
		HTML:    renderInviteHTML(h.cfg.ShopName, name, resetURL),
	})
}

func renderInviteHTML(shopName, name, url string) string {
	return fmt.Sprintf(`<!doctype html>
<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:24px auto;color:#1c1917;">
<h2 style="margin:0 0 16px;font-weight:600;">Welcome to %s</h2>
<p>Hi %s,</p>
<p>An account has been created for you. Click the button below to set a password and start using your account.</p>
<p><a href="%s" style="display:inline-block;padding:10px 18px;background:#1c1917;color:#fff;border-radius:8px;text-decoration:none;">Set your password</a></p>
<p style="color:#78716c;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:<br><span style="word-break:break-all;">%s</span></p>
<p style="color:#78716c;font-size:13px;">This link expires in 1 hour. If you didn't expect this email, you can safely ignore it.</p>
</body></html>`, shopName, name, url, url)
}
