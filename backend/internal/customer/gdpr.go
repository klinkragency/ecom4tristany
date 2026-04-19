package customer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ─── Data export (GDPR Article 15) ──────────────────────────────────────

type dataExport struct {
	GeneratedAt  time.Time      `json:"generatedAt"`
	Customer     map[string]any `json:"customer"`
	Addresses    []map[string]any `json:"addresses"`
	Orders       []map[string]any `json:"orders"`
	StoreCredit  map[string]any `json:"storeCredit"`
	Note         string         `json:"note"`
}

// MyDataExport returns every piece of personal data we hold for the logged-in
// customer as a single JSON file, suitable for a right-of-access request.
func (h *Handler) MyDataExport(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	h.exportAndWrite(w, r, cid)
}

// AdminDataExport is the admin-side variant (for when a customer asks by
// email or phone and staff services the request on their behalf).
func (h *Handler) AdminDataExport(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	h.exportAndWrite(w, r, cid)
}

func (h *Handler) exportAndWrite(w http.ResponseWriter, r *http.Request, cid string) {
	ex, err := buildExport(r.Context(), h, cid)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "customer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "export_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="personal-data-%s.json"`, time.Now().UTC().Format("20060102")))
	_ = writeJSONIndented(w, ex)
}

func buildExport(ctx context.Context, h *Handler, cid string) (*dataExport, error) {
	ex := &dataExport{
		GeneratedAt: time.Now().UTC(),
		Customer:    map[string]any{},
		Addresses:   []map[string]any{},
		Orders:      []map[string]any{},
		StoreCredit: map[string]any{},
		Note:        "Personal data held about you as of the generation time. Orders are retained for legal and tax purposes — the PII on them (name, email, shipping address snapshot) is included here.",
	}

	// Customer row
	var cust struct {
		email, first, last, phone, note string
		consent                          bool
		createdAt, updatedAt             time.Time
		emailVerifiedAt                  *time.Time
	}
	err := h.db.QueryRow(ctx, `
        SELECT email, first_name, last_name, phone, note, marketing_consent,
               created_at, updated_at, email_verified_at
        FROM customers WHERE id = $1
    `, cid).Scan(&cust.email, &cust.first, &cust.last, &cust.phone, &cust.note,
		&cust.consent, &cust.createdAt, &cust.updatedAt, &cust.emailVerifiedAt)
	if err != nil {
		return nil, err
	}
	ex.Customer["id"] = cid
	ex.Customer["email"] = cust.email
	ex.Customer["firstName"] = cust.first
	ex.Customer["lastName"] = cust.last
	ex.Customer["phone"] = cust.phone
	ex.Customer["marketingConsent"] = cust.consent
	ex.Customer["createdAt"] = cust.createdAt
	ex.Customer["updatedAt"] = cust.updatedAt
	ex.Customer["emailVerifiedAt"] = cust.emailVerifiedAt

	// Tags
	trows, _ := h.db.Query(ctx, `SELECT tag FROM customer_tags WHERE customer_id = $1`, cid)
	var tags []string
	for trows.Next() {
		var t string
		if err := trows.Scan(&t); err == nil {
			tags = append(tags, t)
		}
	}
	trows.Close()
	ex.Customer["tags"] = tags

	// Addresses
	arows, err := h.db.Query(ctx, `
        SELECT id, label, first_name, last_name, company, address_line1, address_line2,
               city, region, postal_code, country, phone, is_default_shipping, is_default_billing,
               created_at
        FROM customer_addresses WHERE customer_id = $1
    `, cid)
	if err != nil {
		return nil, err
	}
	for arows.Next() {
		m := map[string]any{}
		var id, label, fn, ln, co, l1, l2, city, region, pc, country, phone string
		var ds, db bool
		var ca time.Time
		if err := arows.Scan(&id, &label, &fn, &ln, &co, &l1, &l2, &city, &region, &pc, &country, &phone, &ds, &db, &ca); err != nil {
			arows.Close()
			return nil, err
		}
		m["id"] = id
		m["label"] = label
		m["firstName"] = fn
		m["lastName"] = ln
		m["company"] = co
		m["addressLine1"] = l1
		m["addressLine2"] = l2
		m["city"] = city
		m["region"] = region
		m["postalCode"] = pc
		m["country"] = country
		m["phone"] = phone
		m["isDefaultShipping"] = ds
		m["isDefaultBilling"] = db
		m["createdAt"] = ca
		ex.Addresses = append(ex.Addresses, m)
	}
	arows.Close()

	// Orders with line items + order_addresses
	orows, err := h.db.Query(ctx, `
        SELECT id, number, status, financial_status, fulfillment_status, currency,
               subtotal_cents, shipping_cents, tax_cents, store_credit_cents, total_cents,
               created_at, paid_at
        FROM orders WHERE customer_id = $1 ORDER BY created_at DESC
    `, cid)
	if err != nil {
		return nil, err
	}
	type orderInfo struct {
		id string
		m  map[string]any
	}
	var orderInfos []orderInfo
	for orows.Next() {
		var id, num, st, fs, fu, cur string
		var sub, shi, tax, sc, tot int
		var ca time.Time
		var paidAt *time.Time
		if err := orows.Scan(&id, &num, &st, &fs, &fu, &cur, &sub, &shi, &tax, &sc, &tot, &ca, &paidAt); err != nil {
			orows.Close()
			return nil, err
		}
		m := map[string]any{
			"id":               id,
			"number":           num,
			"status":           st,
			"financialStatus":  fs,
			"fulfillmentStatus": fu,
			"currency":         cur,
			"subtotalCents":    sub,
			"shippingCents":    shi,
			"taxCents":         tax,
			"storeCreditCents": sc,
			"totalCents":       tot,
			"createdAt":        ca,
			"paidAt":           paidAt,
			"lineItems":        []map[string]any{},
			"addresses":        []map[string]any{},
		}
		orderInfos = append(orderInfos, orderInfo{id: id, m: m})
	}
	orows.Close()
	for _, oi := range orderInfos {
		lrows, _ := h.db.Query(ctx, `
            SELECT product_title, variant_title, sku, unit_price_cents, quantity, total_cents
            FROM order_line_items WHERE order_id = $1 ORDER BY created_at
        `, oi.id)
		var items []map[string]any
		for lrows.Next() {
			var pt, vt, sku string
			var up, qty, tot int
			if err := lrows.Scan(&pt, &vt, &sku, &up, &qty, &tot); err != nil {
				lrows.Close()
				return nil, err
			}
			items = append(items, map[string]any{
				"productTitle": pt, "variantTitle": vt, "sku": sku,
				"unitPriceCents": up, "quantity": qty, "totalCents": tot,
			})
		}
		lrows.Close()
		oi.m["lineItems"] = items

		adrows, _ := h.db.Query(ctx, `
            SELECT kind, first_name, last_name, company, address_line1, address_line2,
                   city, region, postal_code, country, phone
            FROM order_addresses WHERE order_id = $1
        `, oi.id)
		var adds []map[string]any
		for adrows.Next() {
			m := map[string]any{}
			var k, fn, ln, co, l1, l2, city, region, pc, country, phone string
			if err := adrows.Scan(&k, &fn, &ln, &co, &l1, &l2, &city, &region, &pc, &country, &phone); err != nil {
				adrows.Close()
				return nil, err
			}
			m["kind"] = k
			m["firstName"] = fn
			m["lastName"] = ln
			m["company"] = co
			m["addressLine1"] = l1
			m["addressLine2"] = l2
			m["city"] = city
			m["region"] = region
			m["postalCode"] = pc
			m["country"] = country
			m["phone"] = phone
			adds = append(adds, m)
		}
		adrows.Close()
		oi.m["addresses"] = adds
		ex.Orders = append(ex.Orders, oi.m)
	}

	// Store credit ledger
	var balance int
	var currency string
	_ = h.db.QueryRow(ctx,
		`SELECT COALESCE(balance_cents, 0), COALESCE(currency, 'EUR') FROM store_credit_accounts WHERE customer_id = $1`, cid,
	).Scan(&balance, &currency)
	ex.StoreCredit["balanceCents"] = balance
	ex.StoreCredit["currency"] = currency

	lrows, err := h.db.Query(ctx, `
        SELECT id, delta_cents, reason, note, order_id, created_at
        FROM store_credit_ledger WHERE customer_id = $1 ORDER BY created_at
    `, cid)
	if err != nil {
		return nil, err
	}
	var ledger []map[string]any
	for lrows.Next() {
		var id, reason, note string
		var delta int
		var oid *string
		var ca time.Time
		if err := lrows.Scan(&id, &delta, &reason, &note, &oid, &ca); err != nil {
			lrows.Close()
			return nil, err
		}
		ledger = append(ledger, map[string]any{
			"id": id, "deltaCents": delta, "reason": reason, "note": note,
			"orderId": oid, "createdAt": ca,
		})
	}
	lrows.Close()
	ex.StoreCredit["ledger"] = ledger

	return ex, nil
}

// ─── Erasure (GDPR Article 17 / right to be forgotten) ──────────────────

// MyAccountErase lets the customer self-service their right to be forgotten.
// Requires password confirmation to prevent session-hijack-driven deletion.
type EraseReq struct {
	Password string `json:"password"` // required for customer-initiated only
	Note     string `json:"note"`
}

func (h *Handler) MyAccountErase(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var req EraseReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_password",
			"please re-enter your password to confirm account deletion")
		return
	}
	// Verify password.
	var hash string
	if err := h.db.QueryRow(r.Context(),
		`SELECT password_hash FROM customers WHERE id = $1`, cid,
	).Scan(&hash); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if err := auth.VerifyPassword(req.Password, hash); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "bad_password", "password does not match")
		return
	}
	if err := eraseCustomer(r.Context(), h, cid, "customer", "", req.Note); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "erase_error", err.Error())
		return
	}
	// Clear the customer's cookie so they're logged out.
	h.sessions.ClearCookie(w, "customer")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AdminAccountErase(w http.ResponseWriter, r *http.Request) {
	cid := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())
	var req EraseReq
	_ = httpx.DecodeJSON(r, &req) // body is optional for admin path

	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID)
	}
	if err := eraseCustomer(r.Context(), h, cid, "admin", adminID, req.Note); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "erase_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// eraseCustomer anonymizes the customer and cascades clean-up:
//   - addresses, password reset tokens: deleted
//   - sessions: invalidated
//   - customer row: email replaced by deterministic placeholder, names/phone/note blanked
//   - store credit: balance zeroed (debit ledger entry), audit row recorded
//   - orders & order_addresses: **kept** (tax/legal retention); order_addresses
//     are also anonymized so the PII doesn't survive there
//   - store_credit_ledger, order_events: kept (audit trail)
func eraseCustomer(ctx context.Context, h *Handler, cid, erasedBy, adminID, note string) error {
	// Pull original email for the audit hash BEFORE anonymising.
	var originalEmail string
	err := h.db.QueryRow(ctx, `SELECT email FROM customers WHERE id = $1`, cid).Scan(&originalEmail)
	if err != nil {
		return err
	}
	emailHash := sha256.Sum256([]byte(strings.ToLower(originalEmail)))
	emailHashHex := hex.EncodeToString(emailHash[:])

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Zero out the store credit first via the ledger (trigger updates the balance).
	var scBalance int
	_ = tx.QueryRow(ctx,
		`SELECT COALESCE(balance_cents, 0) FROM store_credit_accounts WHERE customer_id = $1`, cid,
	).Scan(&scBalance)
	if scBalance > 0 {
		if _, err := tx.Exec(ctx, `
            INSERT INTO store_credit_ledger (customer_id, delta_cents, reason, note)
            VALUES ($1, $2, 'expiration', 'Balance zeroed on account erasure')
        `, cid, -scBalance); err != nil {
			return err
		}
	}

	// Placeholder email is deterministic so a repeated erase on the same
	// customer stays idempotent and we never collide with a real address.
	placeholderEmail := fmt.Sprintf("deleted-%s@shop.deleted", emailHashHex[:16])

	// Anonymize the customer row. Keep password_hash for audit but prefix with
	// "x" to invalidate it (argon2id parser will reject the format).
	if _, err := tx.Exec(ctx, `
        UPDATE customers SET
          email = $1,
          first_name = '',
          last_name = '',
          phone = '',
          note = '',
          marketing_consent = false,
          password_hash = 'x' || password_hash,
          email_verified_at = NULL,
          updated_at = now()
        WHERE id = $2
    `, placeholderEmail, cid); err != nil {
		return err
	}

	// Addresses + reset tokens + sessions.
	if _, err := tx.Exec(ctx, `DELETE FROM customer_addresses WHERE customer_id = $1`, cid); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM customer_password_resets WHERE customer_id = $1`, cid); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM sessions WHERE user_type = 'customer' AND user_id = $1`, cid); err != nil {
		return err
	}

	// Anonymize order_address snapshots (tax retention keeps the order itself).
	if _, err := tx.Exec(ctx, `
        UPDATE order_addresses SET
          first_name = 'Redacted',
          last_name = '',
          company = '',
          address_line1 = '',
          address_line2 = '',
          city = '',
          region = '',
          postal_code = '',
          phone = ''
        WHERE order_id IN (SELECT id FROM orders WHERE customer_id = $1)
    `, cid); err != nil {
		return err
	}
	// Replace customer email on orders (for receipts). country stays for tax.
	if _, err := tx.Exec(ctx, `
        UPDATE orders SET email = $1, phone = '', ip = '', user_agent = ''
        WHERE customer_id = $2
    `, placeholderEmail, cid); err != nil {
		return err
	}

	// Audit trail.
	if _, err := tx.Exec(ctx, `
        INSERT INTO customer_erasures (customer_id, original_email_hash, erased_by, admin_id)
        VALUES ($1, $2, $3, NULLIF($4, '')::uuid)
    `, cid, emailHashHex, erasedBy, adminID); err != nil {
		return err
	}
	_ = note // reserved for future use (not persisted yet — audit row is enough)

	return tx.Commit(ctx)
}

// Small helper: stdlib json.Encoder with indent, writing directly to the
// response (no intermediate buffer).
func writeJSONIndented(w http.ResponseWriter, v any) error {
	enc := jsonEncoder(w)
	return enc.Encode(v)
}
