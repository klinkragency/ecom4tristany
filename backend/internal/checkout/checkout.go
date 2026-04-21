package checkout

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/discount"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/payments"
	"github.com/3mg/shop/backend/internal/session"
	shipping_ "github.com/3mg/shop/backend/internal/shipping"
	tax_ "github.com/3mg/shop/backend/internal/tax"

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
	BillingSameAsShipping bool   `json:"billingSameAsShipping"`
	ShippingRateID        string `json:"shippingRateId"`
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
	DiscountCents    int    `json:"discountCents"`
	DiscountCode     string `json:"discountCode,omitempty"`
	DiscountTitle    string `json:"discountTitle,omitempty"`
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
	weightGrams := 0
	for _, l := range lines {
		subtotal += l.unitPriceCents * l.quantity
		weightGrams += l.weightGrams * l.quantity
	}

	// Resolve shipping. Preference order:
	//   1. Client sent shippingRateId → verify and use (protects against price tampering).
	//   2. Otherwise, if the destination country has any zone configured, the
	//      cheapest active rate is used automatically.
	//   3. If no zones cover the country yet, fall back to FlatShippingCents
	//      so the checkout still functions during initial setup.
	shipping := FlatShippingCents
	shippingMethod := "Standard"
	if req.ShippingRateID != "" {
		snap, err := shipping_.Resolve(r.Context(), h.db, req.ShippingRateID, req.Shipping.Country, subtotal, weightGrams)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "shipping_rate_invalid", err.Error())
			return
		}
		shipping = snap.PriceCents
		shippingMethod = snap.Name
	} else {
		rates, rerr := shipping_.QuoteForCart(r.Context(), h.db, req.Shipping.Country, subtotal, weightGrams)
		if rerr == nil && len(rates) > 0 {
			// Pick the cheapest — the storefront is expected to send shippingRateId
			// from its selector; this only happens when the client forgot.
			cheapest := rates[0]
			for _, rt := range rates[1:] {
				if rt.PriceCents < cheapest.PriceCents {
					cheapest = rt
				}
			}
			shipping = cheapest.PriceCents
			shippingMethod = cheapest.Name
		}
	}

	// Determine customer_id if authenticated (needed before discount eval for
	// per-customer limit + segment-eligibility checks).
	var customerID *string
	if sess, ok := auth.SessionFromContext(r.Context()); ok && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		customerID = &cid
	}

	// Resolve the discount code saved on the cart (if any) + any active
	// automatic discounts. The engine returns per-line + shipping deductions.
	// If the stored code is no longer valid, we abort checkout with a clear
	// error so the buyer can fix the cart before paying.
	var storedCode *string
	_ = h.db.QueryRow(r.Context(),
		`SELECT discount_code FROM carts WHERE id = $1`, cartID,
	).Scan(&storedCode)
	engineLines := make([]discount.CartLine, 0, len(lines))
	for i, l := range lines {
		// Line IDs aren't assigned until the order row is inserted; use the
		// stable cart-index as a key so we can match back to `lines[i]` after
		// evaluation.
		engineLines = append(engineLines, discount.CartLine{
			LineID:         strconv.Itoa(i),
			VariantID:      l.variantID,
			ProductID:      l.productID,
			UnitPriceCents: l.unitPriceCents,
			Quantity:       l.quantity,
		})
	}
	discInput := discount.Input{
		Lines:         engineLines,
		SubtotalCents: subtotal,
		ShippingCents: shipping,
		CustomerID:    customerID,
	}
	if storedCode != nil {
		discInput.Code = *storedCode
	}
	discRes, err := discount.Evaluate(r.Context(), h.db, discInput)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "discount_error", err.Error())
		return
	}
	if storedCode != nil && discRes.CodeError != "" {
		httpx.Error(w, http.StatusBadRequest, "discount_invalid", discRes.CodeError)
		return
	}

	discountOff := discRes.TotalOff()
	shippingAfter := shipping - discRes.ShippingDiscount
	if shippingAfter < 0 {
		shippingAfter = 0
	}

	gross := subtotal - discountOff + shippingAfter
	if gross < 0 {
		gross = 0
	}
	// Pick the VAT rate by destination country if we have one on file,
	// otherwise fall back to the shop default.
	vatPercent := h.cfg.ShopVATPercent
	if p, ok := tax_.ResolvePercent(r.Context(), h.db, req.Shipping.Country); ok {
		vatPercent = p
	}
	tax := BackSolveVAT(gross, vatPercent)
	total := gross // tax-inclusive grand total

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

	// Build per-line discount map (line index → cents off) from the engine result.
	lineDiscountCents := make([]int, len(lines))
	for _, ld := range discRes.LineDiscounts {
		if idx, err := strconv.Atoi(ld.LineID); err == nil && idx >= 0 && idx < len(lineDiscountCents) {
			lineDiscountCents[idx] = ld.Cents
		}
	}

	var orderID, orderNumber string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO orders (customer_id, email, phone, currency,
                            subtotal_cents, discount_cents, tax_cents, shipping_cents,
                            store_credit_cents, total_cents, shipping_method,
                            discount_code, discount_title,
                            note, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12,''), $13, $14, $15, $16)
        RETURNING id, number
    `, customerID, req.Email, req.Phone, h.cfg.ShopCurrency,
		subtotal, discountOff, tax, shippingAfter, storeCreditApplied, chargeTotal, shippingMethod,
		discRes.AppliedCode, discRes.AppliedTitle,
		req.Note, clientIP(r), r.UserAgent(),
	).Scan(&orderID, &orderNumber)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "order_insert", err.Error())
		return
	}

	// Line items: snapshot everything including any per-line discount.
	for i, l := range lines {
		lineSubtotal := l.unitPriceCents * l.quantity
		lineDiscount := lineDiscountCents[i]
		if lineDiscount > lineSubtotal {
			lineDiscount = lineSubtotal
		}
		lineTotal := lineSubtotal - lineDiscount
		_, err = tx.Exec(r.Context(), `
            INSERT INTO order_line_items (order_id, variant_id, product_id,
                                          product_title, variant_title, sku, image_url,
                                          unit_price_cents, quantity, subtotal_cents,
                                          discount_cents, tax_cents, total_cents)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12)
        `, orderID, l.variantID, l.productID,
			l.productTitle, l.variantTitle, l.sku, l.imageURL,
			l.unitPriceCents, l.quantity, lineSubtotal, lineDiscount, lineTotal)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "line_insert", err.Error())
			return
		}
	}

	// Record a discount_usages row per applied discount + bump usage_count.
	// discount_usages.applied_cents is the total deduction attributable to
	// that one discount across all lines (plus any shipping discount it
	// contributed, for free_shipping).
	perDiscountCents := map[string]int{}
	for _, ld := range discRes.LineDiscounts {
		perDiscountCents[ld.DiscountID] += ld.Cents
	}
	if discRes.ShippingDiscount > 0 {
		// Attribute shipping deduction to whichever discount id is in the
		// applied set with kind free_shipping (engine returns it as applied
		// even when cents=0 — so add a catch-all here only if exactly one id
		// applied).
		// Keep simple: record it against the first applied discount that
		// isn't already charged with line discounts.
		for _, id := range discRes.AppliedDiscountIDs {
			if _, ok := perDiscountCents[id]; !ok {
				perDiscountCents[id] = discRes.ShippingDiscount
				break
			}
		}
	}
	for _, id := range discRes.AppliedDiscountIDs {
		cents := perDiscountCents[id]
		if _, err := tx.Exec(r.Context(), `
            INSERT INTO discount_usages (discount_id, order_id, customer_id, applied_cents, code_snapshot)
            VALUES ($1, $2, $3, $4, $5)
        `, id, orderID, customerID, cents, discRes.AppliedCode); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "usage_insert", err.Error())
			return
		}
		if _, err := tx.Exec(r.Context(),
			`UPDATE discounts SET usage_count = usage_count + 1, updated_at = now() WHERE id = $1`, id,
		); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "usage_bump", err.Error())
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
		DiscountCents:    discountOff,
		DiscountCode:     discRes.AppliedCode,
		DiscountTitle:    discRes.AppliedTitle,
		ShippingCents:    shippingAfter,
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
	weightGrams    int
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
               v.price_cents, v.weight_grams, ci.quantity,
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
			&l.sku, &l.imageURL, &l.unitPriceCents, &l.weightGrams, &l.quantity, &l.available); err != nil {
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
