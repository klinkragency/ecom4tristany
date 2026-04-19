package checkout

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/payments"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Shipping is hard-coded flat for Phase 3 MVP. Phase 5 will add real zones + rates.
const FlatShippingCents = 500 // €5.00

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
	pay *payments.Client
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config, pay *payments.Client) *Handler {
	return &Handler{db: db, cfg: cfg, pay: pay}
}

// ─── Init ────────────────────────────────────────────────────────────────

type InitReq struct {
	Email    string  `json:"email"`
	Phone    string  `json:"phone"`
	Shipping Address `json:"shipping"`
	Billing  Address `json:"billing"`
	// When true, reuse the shipping address for billing.
	BillingSameAsShipping bool `json:"billingSameAsShipping"`
	Note                  string `json:"note"`
}

type Address struct {
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Company      string `json:"company"`
	AddressLine1 string `json:"addressLine1"`
	AddressLine2 string `json:"addressLine2"`
	City         string `json:"city"`
	Region       string `json:"region"`
	PostalCode   string `json:"postalCode"`
	Country      string `json:"country"`
	Phone        string `json:"phone"`
}

type InitResp struct {
	OrderID          string `json:"orderId"`
	OrderNumber      string `json:"orderNumber"`
	ClientSecret     string `json:"clientSecret"`
	PublishableKey   string `json:"publishableKey"`
	Currency         string `json:"currency"`
	SubtotalCents    int    `json:"subtotalCents"`
	ShippingCents    int    `json:"shippingCents"`
	TaxCents         int    `json:"taxCents"`
	StoreCreditCents int    `json:"storeCreditCents"`
	TotalCents       int    `json:"totalCents"`
}

// Init validates the customer's cart, creates a pending order + Stripe
// PaymentIntent, and returns the client secret the browser needs to collect
// payment through Stripe's Payment Element.
func (h *Handler) Init(w http.ResponseWriter, r *http.Request) {
	if !h.pay.Enabled() {
		httpx.Error(w, http.StatusServiceUnavailable, "payments_disabled",
			"Stripe is not configured — set STRIPE_SECRET_KEY in .env")
		return
	}

	var req InitReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_email", "email required")
		return
	}
	if req.BillingSameAsShipping {
		req.Billing = req.Shipping
	}
	if err := validateAddress(&req.Shipping); err != nil {
		httpx.Error(w, http.StatusBadRequest, "shipping_invalid", err.Error())
		return
	}
	if err := validateAddress(&req.Billing); err != nil {
		httpx.Error(w, http.StatusBadRequest, "billing_invalid", err.Error())
		return
	}

	// Find the customer's cart (by customer_id session or by cart_token cookie).
	cartID, err := h.findCart(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "no_cart", err.Error())
		return
	}

	// Load cart items with product snapshot.
	lines, err := h.loadCartLines(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if len(lines) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty_cart", "cart is empty")
		return
	}

	// Verify all items are available.
	for _, l := range lines {
		if !l.available {
			httpx.Error(w, http.StatusConflict, "line_unavailable",
				"one or more items in your cart are no longer available")
			return
		}
	}

	// Totals (tax-inclusive prices).
	subtotal := 0
	for _, l := range lines {
		subtotal += l.unitPriceCents * l.quantity
	}
	shipping := FlatShippingCents
	gross := subtotal + shipping
	tax := BackSolveVAT(gross, h.cfg.ShopVATPercent)
	total := gross // tax-inclusive grand total

	// Determine customer_id if authenticated.
	var customerID *string
	if sess, ok := auth.SessionFromContext(r.Context()); ok && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		customerID = &cid
	}

	// Store credit — auto-apply if the customer has a balance. Keep at least
	// €1 on the Stripe charge (Payment Intent minimum) so we never have to
	// skip Stripe entirely for now.
	const minStripeCharge = 100 // cents
	storeCreditApplied := 0
	if customerID != nil {
		var balance int
		_ = h.db.QueryRow(r.Context(),
			`SELECT COALESCE(balance_cents, 0) FROM store_credit_accounts WHERE customer_id = $1`,
			*customerID,
		).Scan(&balance)
		if balance > 0 && total > minStripeCharge {
			max := total - minStripeCharge
			if balance < max {
				storeCreditApplied = balance
			} else {
				storeCreditApplied = max
			}
		}
	}
	chargeTotal := total - storeCreditApplied

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var orderID, orderNumber string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO orders (customer_id, email, phone, currency,
                            subtotal_cents, discount_cents, tax_cents, shipping_cents,
                            store_credit_cents, total_cents,
                            note, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, number
    `, customerID, req.Email, req.Phone, h.cfg.ShopCurrency,
		subtotal, tax, shipping, storeCreditApplied, chargeTotal,
		req.Note, clientIP(r), r.UserAgent(),
	).Scan(&orderID, &orderNumber)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "order_insert", err.Error())
		return
	}

	// Line items: snapshot everything.
	for _, l := range lines {
		lineTotal := l.unitPriceCents * l.quantity
		_, err = tx.Exec(r.Context(), `
            INSERT INTO order_line_items (order_id, variant_id, product_id,
                                          product_title, variant_title, sku, image_url,
                                          unit_price_cents, quantity, subtotal_cents,
                                          discount_cents, tax_cents, total_cents)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0, $10)
        `, orderID, l.variantID, l.productID,
			l.productTitle, l.variantTitle, l.sku, l.imageURL,
			l.unitPriceCents, l.quantity, lineTotal)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "line_insert", err.Error())
			return
		}
	}

	// Addresses.
	for _, a := range []struct {
		kind string
		addr Address
	}{{"shipping", req.Shipping}, {"billing", req.Billing}} {
		_, err = tx.Exec(r.Context(), `
            INSERT INTO order_addresses (order_id, kind, first_name, last_name, company,
                                         address_line1, address_line2, city, region, postal_code, country, phone)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, orderID, a.kind, a.addr.FirstName, a.addr.LastName, a.addr.Company,
			a.addr.AddressLine1, a.addr.AddressLine2, a.addr.City, a.addr.Region,
			a.addr.PostalCode, a.addr.Country, a.addr.Phone)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "address_insert", err.Error())
			return
		}
	}

	// Timeline entry.
	_, err = tx.Exec(r.Context(), `
        INSERT INTO order_events (order_id, kind, payload)
        VALUES ($1, 'created', $2)
    `, orderID, map[string]any{"subtotal_cents": subtotal, "total_cents": total})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "event_insert", err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	// Create PaymentIntent AFTER the order is persisted so we can put the
	// order_id into its metadata. Amount = charge total (already minus any
	// store credit). If this fails we leave a pending order record — webhook
	// flow won't trigger, so the customer can retry.
	pi, err := h.pay.CreatePaymentIntent(int64(chargeTotal), strings.ToLower(h.cfg.ShopCurrency), orderID, req.Email)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "stripe_error", err.Error())
		return
	}

	// Record the payment row (status = requires_payment_method initially).
	_, err = h.db.Exec(r.Context(), `
        INSERT INTO payments (order_id, provider, provider_ref, status, amount_cents, currency)
        VALUES ($1, 'stripe', $2, $3, $4, $5)
    `, orderID, pi.ID, string(pi.Status), chargeTotal, strings.ToUpper(h.cfg.ShopCurrency))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "payment_insert", err.Error())
		return
	}

	httpx.JSON(w, http.StatusOK, InitResp{
		OrderID:          orderID,
		OrderNumber:      orderNumber,
		ClientSecret:     pi.ClientSecret,
		PublishableKey:   h.cfg.StripePublishableKey,
		Currency:         h.cfg.ShopCurrency,
		SubtotalCents:    subtotal,
		ShippingCents:    shipping,
		TaxCents:         tax,
		StoreCreditCents: storeCreditApplied,
		TotalCents:       chargeTotal,
	})
}

func validateAddress(a *Address) error {
	if a.FirstName == "" || a.LastName == "" {
		return errors.New("first and last name required")
	}
	if a.AddressLine1 == "" || a.City == "" || a.PostalCode == "" || a.Country == "" {
		return errors.New("address line 1, city, postal code and country required")
	}
	// Country is ISO-3166-1 alpha-2 (e.g. FR) — must be 2 uppercase letters.
	if len(a.Country) != 2 {
		return errors.New("country must be a 2-letter ISO code (e.g. FR)")
	}
	a.Country = strings.ToUpper(a.Country)
	return nil
}

// ─── Cart loading ────────────────────────────────────────────────────────

type cartLine struct {
	variantID      string
	productID      string
	productTitle   string
	variantTitle   string
	sku            string
	imageURL       string
	unitPriceCents int
	quantity       int
	available      bool
}

func (h *Handler) loadCartLines(ctx context.Context, cartID string) ([]cartLine, error) {
	rows, err := h.db.Query(ctx, `
        SELECT v.id, p.id, p.title,
               COALESCE(
                   (SELECT string_agg(ov.value, ' / ' ORDER BY po.position)
                    FROM variant_option_values vov
                    JOIN option_values ov ON ov.id = vov.value_id
                    JOIN product_options po ON po.id = vov.option_id
                    WHERE vov.variant_id = v.id),
                   ''
               ),
               v.sku,
               COALESCE(
                   (SELECT url FROM product_media WHERE product_id = p.id ORDER BY position LIMIT 1),
                   ''
               ),
               v.price_cents, ci.quantity,
               p.status = 'active' AS available
        FROM cart_items ci
        JOIN variants v  ON v.id = ci.variant_id
        JOIN products p  ON p.id = v.product_id
        WHERE ci.cart_id = $1
    `, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []cartLine
	for rows.Next() {
		var l cartLine
		if err := rows.Scan(&l.variantID, &l.productID, &l.productTitle, &l.variantTitle,
			&l.sku, &l.imageURL, &l.unitPriceCents, &l.quantity, &l.available); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, nil
}

// findCart locates the buyer's cart using either the customer session or the
// cart_token cookie set by the cart handler.
func (h *Handler) findCart(r *http.Request) (string, error) {
	if sess, ok := auth.SessionFromContext(r.Context()); ok && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		var id string
		err := h.db.QueryRow(r.Context(),
			`SELECT id FROM carts WHERE customer_id = $1`, cid).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
	}
	// Fallback to cookie.
	if c, err := r.Cookie("cart_token"); err == nil && c.Value != "" {
		var id string
		err := h.db.QueryRow(r.Context(),
			`SELECT id FROM carts WHERE token = $1`, c.Value).Scan(&id)
		if err == nil {
			return id, nil
		}
	}
	return "", errors.New("no cart found")
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		return xf
	}
	host := r.RemoteAddr
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
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
