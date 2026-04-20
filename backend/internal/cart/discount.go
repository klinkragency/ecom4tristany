package cart

import (
	"context"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/discount"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"
)

// ─── Apply / remove a discount code ─────────────────────────────────────

type applyReq struct {
	Code string `json:"code"`
}

// ApplyDiscount stores a code on the cart. We only validate *shape* here —
// eligibility is re-checked on every cart projection and at checkout so any
// later cart changes (e.g., removing an item that was required to meet the
// min subtotal) surface the right error at the right time.
func (h *Handler) ApplyDiscount(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "cart_error", err.Error())
		return
	}
	var req applyReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_code", "code required")
		return
	}
	if _, err := h.db.Exec(r.Context(),
		`UPDATE carts SET discount_code = $1, updated_at = now() WHERE id = $2`,
		code, cartID,
	); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	// Project the cart so the response includes the evaluated discount.
	cart, err := h.loadAndEvaluate(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	if cart.DiscountError != "" {
		// Keep the code on the cart so the UI can display the error next to
		// the input, but make the error HTTP-level so the fetch() rejects.
		httpx.Error(w, http.StatusUnprocessableEntity, "invalid_code", cart.DiscountError)
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

// RemoveDiscount clears the code on the cart.
func (h *Handler) RemoveDiscount(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "cart_error", err.Error())
		return
	}
	if _, err := h.db.Exec(r.Context(),
		`UPDATE carts SET discount_code = NULL, updated_at = now() WHERE id = $1`, cartID,
	); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	cart, err := h.loadAndEvaluate(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

// LoadAndEvaluate is exposed so the existing Get handler can call it without
// reimplementing discount resolution.
func (h *Handler) LoadAndEvaluate(ctx context.Context, cartID string) (*Cart, error) {
	return h.loadAndEvaluate(ctx, cartID)
}

// loadAndEvaluate projects the cart then runs the discount engine, attaching
// the result to the response. When the code stored on the cart fails
// validation we expose the reason in DiscountError but leave the code on the
// cart so the buyer can correct it.
func (h *Handler) loadAndEvaluate(ctx context.Context, cartID string) (*Cart, error) {
	c, err := h.load(ctx, cartID)
	if err != nil {
		return nil, err
	}
	// Build engine input.
	lines := make([]discount.CartLine, 0, len(c.Items))
	for _, it := range c.Items {
		lines = append(lines, discount.CartLine{
			LineID:         it.ID,
			VariantID:      it.VariantID,
			ProductID:      "", // will fill below
			UnitPriceCents: it.UnitPriceCents,
			Quantity:       it.Quantity,
		})
	}
	// Populate ProductID by variant lookup — cheap per-cart query.
	if len(lines) > 0 {
		variantIDs := make([]any, 0, len(lines))
		placeholders := make([]string, 0, len(lines))
		for i, l := range lines {
			variantIDs = append(variantIDs, l.VariantID)
			placeholders = append(placeholders, "$"+itoa(i+1))
		}
		query := `SELECT id, product_id FROM variants WHERE id IN (` + strings.Join(placeholders, ",") + `)`
		rows, err := h.db.Query(ctx, query, variantIDs...)
		if err != nil {
			return nil, err
		}
		byVariant := map[string]string{}
		for rows.Next() {
			var vID, pID string
			if err := rows.Scan(&vID, &pID); err != nil {
				rows.Close()
				return nil, err
			}
			byVariant[vID] = pID
		}
		rows.Close()
		for i := range lines {
			lines[i].ProductID = byVariant[lines[i].VariantID]
		}
	}

	var customerID *string
	if sess, authed := auth.SessionFromContext(ctx); authed && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		customerID = &cid
	}

	res, err := discount.Evaluate(ctx, h.db, discount.Input{
		Lines:         lines,
		SubtotalCents: c.SubtotalCents,
		// Shipping not known at cart stage → 0. Free-shipping discounts still
		// record they *would* apply via FreeShipping=true on the result.
		ShippingCents: 0,
		CustomerID:    customerID,
		Code:          c.DiscountCode,
	})
	if err != nil {
		return nil, err
	}
	c.DiscountCents = res.TotalOff()
	c.DiscountTitle = res.AppliedTitle
	c.FreeShipping = res.FreeShipping
	if c.DiscountCode != "" && res.CodeError != "" {
		c.DiscountError = res.CodeError
		c.DiscountCents = 0
		c.DiscountTitle = ""
	}
	return c, nil
}

// itoa is a tiny local int-to-string to avoid importing strconv just for this.
func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var digits [12]byte
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
