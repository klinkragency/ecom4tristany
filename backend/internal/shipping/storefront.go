package shipping

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// QuoteReq is the storefront request: the client passes a destination country
// (the country they entered in the shipping address on the checkout page).
// The cart is resolved from the customer/guest cookie.
type QuoteReq struct {
	Country string `json:"country"`
}

// QuotedRate is a rate with the final price already computed for the given
// cart (zero when free_over_cents kicks in). The storefront renders these as
// a radio group.
type QuotedRate struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	PriceCents  int    `json:"priceCents"`
	Free        bool   `json:"free"`      // true when free-shipping threshold triggered
	Description string `json:"description"`
}

type QuoteResp struct {
	Country         string       `json:"country"`
	SubtotalCents   int          `json:"subtotalCents"`
	TotalWeightGrams int         `json:"totalWeightGrams"`
	Rates           []QuotedRate `json:"rates"`
}

// Quote resolves the cart from its cookie, looks up the zone for the given
// country, and returns one QuotedRate per active rate in that zone.
//
// If there is no zone covering the country, rates is an empty array — the
// storefront is expected to render "We don't ship to {country} yet".
func (h *Handler) Quote(w http.ResponseWriter, r *http.Request) {
	var req QuoteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	country := strings.ToUpper(strings.TrimSpace(req.Country))
	if len(country) != 2 {
		httpx.Error(w, http.StatusBadRequest, "invalid_country", "country must be ISO-2")
		return
	}

	// Resolve cart (guest or customer). We accept either cookie: the route is
	// wrapped with OptionalCustomer + cart-by-token middleware at router level.
	cartID, ok := cartIDFromRequest(r)
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "no_cart", "no cart — add items first")
		return
	}

	subtotal, weightG, err := cartWeightAndSubtotal(r.Context(), h.db, cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "cart_error", err.Error())
		return
	}

	rates, err := QuoteForCart(r.Context(), h.db, country, subtotal, weightG)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "quote_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, QuoteResp{
		Country:          country,
		SubtotalCents:    subtotal,
		TotalWeightGrams: weightG,
		Rates:            rates,
	})
}

// QuoteForCart is exported so the checkout package can call it when building
// an order without a separate HTTP round-trip.
func QuoteForCart(ctx context.Context, db *pgxpool.Pool, country string, subtotalCents, weightGrams int) ([]QuotedRate, error) {
	country = strings.ToUpper(strings.TrimSpace(country))
	// Find the zone that covers this country.
	var zoneID string
	err := db.QueryRow(ctx,
		`SELECT zone_id FROM shipping_zone_countries WHERE country = $1`, country,
	).Scan(&zoneID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return []QuotedRate{}, nil
		}
		return nil, err
	}

	rows, err := db.Query(ctx, `
        SELECT id, name, kind, flat_cents, per_kg_cents, min_cents, free_over_cents
        FROM shipping_rates
        WHERE zone_id = $1 AND active = true
        ORDER BY position, flat_cents
    `, zoneID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuotedRate{}
	for rows.Next() {
		var id, name, kind string
		var flat, perKg, min int
		var freeOver *int
		if err := rows.Scan(&id, &name, &kind, &flat, &perKg, &min, &freeOver); err != nil {
			return nil, err
		}
		price := computePrice(kind, flat, perKg, min, weightGrams)
		free := false
		if freeOver != nil && subtotalCents >= *freeOver {
			price = 0
			free = true
		}
		out = append(out, QuotedRate{
			ID:          id,
			Name:        name,
			Kind:        kind,
			PriceCents:  price,
			Free:        free,
			Description: describeRate(kind, flat, perKg, min, freeOver, weightGrams, free),
		})
	}
	return out, nil
}

// RateSnapshot is the slim projection the checkout needs to snapshot a rate
// on an order. Unlike QuotedRate it includes only the fields required to
// reproduce the final price at checkout time, not presentation-only flags.
type RateSnapshot struct {
	ID         string
	Name       string
	PriceCents int
}

// Resolve verifies that a rate ID is valid for the given country/cart and
// returns its snapshot with a freshly-computed price. Called by checkout.Init
// to avoid trusting the client-sent price.
func Resolve(ctx context.Context, db *pgxpool.Pool, rateID, country string, subtotalCents, weightGrams int) (*RateSnapshot, error) {
	var zoneID, name, kind string
	var flat, perKg, min int
	var freeOver *int
	err := db.QueryRow(ctx, `
        SELECT zone_id, name, kind, flat_cents, per_kg_cents, min_cents, free_over_cents
        FROM shipping_rates
        WHERE id = $1 AND active = true
    `, rateID).Scan(&zoneID, &name, &kind, &flat, &perKg, &min, &freeOver)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("rate not found or inactive")
		}
		return nil, err
	}
	// Ensure the rate's zone covers the requested country.
	var exists bool
	err = db.QueryRow(ctx, `
        SELECT EXISTS (
          SELECT 1 FROM shipping_zone_countries
          WHERE zone_id = $1 AND country = $2
        )
    `, zoneID, strings.ToUpper(country)).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, errors.New("rate is not valid for the destination country")
	}
	price := computePrice(kind, flat, perKg, min, weightGrams)
	if freeOver != nil && subtotalCents >= *freeOver {
		price = 0
	}
	return &RateSnapshot{ID: rateID, Name: name, PriceCents: price}, nil
}

func computePrice(kind string, flatCents, perKgCents, minCents, weightGrams int) int {
	switch kind {
	case "flat":
		return flatCents
	case "weight":
		// Round up any partial kilo — carriers charge per started kilo.
		kilos := (weightGrams + 999) / 1000
		p := kilos * perKgCents
		if p < minCents {
			p = minCents
		}
		return p
	}
	return 0
}

func describeRate(kind string, flat, perKg, min int, freeOver *int, weightGrams int, free bool) string {
	if free {
		return "Free shipping promotion"
	}
	switch kind {
	case "flat":
		return ""
	case "weight":
		kilos := (weightGrams + 999) / 1000
		if kilos == 0 {
			kilos = 1
		}
		// Simple note; storefront adds currency.
		return "weight-based"
	}
	return ""
}

// ─── Cart loading helpers ───────────────────────────────────────────────

// cartIDFromRequest reads the cart cookie and resolves the cart ID. The cart
// package already exposes this behaviour via its middleware, but doing the
// lookup inline keeps the shipping package self-contained.
func cartIDFromRequest(r *http.Request) (string, bool) {
	c, err := r.Cookie(cartCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	return c.Value, true
}

// cartCookieName must match cart.CartCookie. Importing the cart package here
// would create a dependency cycle (cart.RateSnapshot? no — but checkout will
// import shipping, and we want cart to stay slim), so the name is redeclared.
const cartCookieName = "cart_token"

// cartWeightAndSubtotal sums the cart's subtotal and total weight from the
// current variant prices/weights. We deliberately re-compute from the DB
// rather than trust the client.
func cartWeightAndSubtotal(ctx context.Context, db *pgxpool.Pool, cartID string) (int, int, error) {
	// cartID here is actually the cart *token* stored in the cookie. Translate.
	var realID string
	err := db.QueryRow(ctx, `SELECT id FROM carts WHERE token = $1`, cartID).Scan(&realID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, 0, nil
		}
		return 0, 0, err
	}

	var subtotal, weight int
	err = db.QueryRow(ctx, `
        SELECT
          COALESCE(SUM(v.price_cents * ci.quantity), 0),
          COALESCE(SUM(v.weight_grams * ci.quantity), 0)
        FROM cart_items ci
        JOIN variants v ON v.id = ci.variant_id
        WHERE ci.cart_id = $1
    `, realID).Scan(&subtotal, &weight)
	if err != nil {
		return 0, 0, err
	}
	return subtotal, weight, nil
}

// Silence unused-import errors in case session tooling is later hooked here.
var _ = session.TypeCustomer
