package cart

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const CartCookie = "cart_token"

type Handler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewHandler(db *pgxpool.Pool, cfg *config.Config) *Handler {
	return &Handler{db: db, cfg: cfg}
}

// ─── Identification ──────────────────────────────────────────────────────

// identify locates (or creates) the cart for this request. A cart lives in a
// cookie on the browser (`cart_token`) and may also be attached to a logged-in
// customer session. The cookie is set only when a new cart is created.
func (h *Handler) identify(w http.ResponseWriter, r *http.Request) (string, error) {
	ctx := r.Context()

	// Prefer the authenticated customer when one is available.
	sess, authed := auth.SessionFromContext(ctx)
	var customerID *string
	if authed && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		customerID = &cid
	}

	// Try cookie token first.
	cookieTok := ""
	if c, err := r.Cookie(CartCookie); err == nil && c.Value != "" {
		cookieTok = c.Value
	}

	// 1. If authenticated, any existing customer cart wins. Merge the cookie
	//    cart into it if the customer's cart didn't exist yet.
	if customerID != nil {
		var custCartID string
		err := h.db.QueryRow(ctx,
			`SELECT id FROM carts WHERE customer_id = $1`, *customerID).Scan(&custCartID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Create a fresh cart for the customer.
			if err := h.db.QueryRow(ctx, `
                INSERT INTO carts (customer_id, token) VALUES ($1, NULL) RETURNING id
            `, *customerID).Scan(&custCartID); err != nil {
				return "", err
			}
		} else if err != nil {
			return "", err
		}

		// Merge anonymous cookie cart into customer cart (if present and different).
		if cookieTok != "" {
			if err := h.mergeAnonIntoCustomer(ctx, cookieTok, custCartID); err != nil {
				return "", err
			}
			// Wipe the anonymous cookie once merged.
			clearCookie(w, h.cfg)
		}
		return custCartID, nil
	}

	// 2. Anonymous user.
	if cookieTok != "" {
		var id string
		err := h.db.QueryRow(ctx,
			`SELECT id FROM carts WHERE token = $1`, cookieTok).Scan(&id)
		if err == nil {
			return id, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		// Token present but cart missing: fall through and make a new one.
	}

	tok, err := newToken()
	if err != nil {
		return "", err
	}
	var id string
	err = h.db.QueryRow(ctx,
		`INSERT INTO carts (token) VALUES ($1) RETURNING id`, tok).Scan(&id)
	if err != nil {
		return "", err
	}
	setCookie(w, h.cfg, tok)
	return id, nil
}

func (h *Handler) mergeAnonIntoCustomer(ctx context.Context, cookieTok, custCartID string) error {
	var anonID string
	err := h.db.QueryRow(ctx, `SELECT id FROM carts WHERE token = $1`, cookieTok).Scan(&anonID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if anonID == custCartID {
		return nil
	}
	// Copy items: increment qty if same variant already in cart.
	_, err = h.db.Exec(ctx, `
        INSERT INTO cart_items (cart_id, variant_id, quantity)
        SELECT $1, variant_id, quantity FROM cart_items WHERE cart_id = $2
        ON CONFLICT (cart_id, variant_id)
        DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `, custCartID, anonID)
	if err != nil {
		return err
	}
	_, err = h.db.Exec(ctx, `DELETE FROM carts WHERE id = $1`, anonID)
	return err
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func setCookie(w http.ResponseWriter, cfg *config.Config, tok string) {
	http.SetCookie(w, &http.Cookie{
		Name:     CartCookie,
		Value:    tok,
		Path:     "/",
		Domain:   cfg.SessionCookieDomain,
		HttpOnly: true,
		Secure:   cfg.SessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 24 * 30, // 30 days
	})
}

func clearCookie(w http.ResponseWriter, cfg *config.Config) {
	http.SetCookie(w, &http.Cookie{
		Name:     CartCookie,
		Value:    "",
		Path:     "/",
		Domain:   cfg.SessionCookieDomain,
		HttpOnly: true,
		Secure:   cfg.SessionCookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// ─── HTTP handlers ───────────────────────────────────────────────────────

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "identify_error", err.Error())
		return
	}
	cart, err := h.loadAndEvaluate(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

type AddReq struct {
	VariantID string `json:"variantId"`
	Quantity  int    `json:"quantity"`
}

func (h *Handler) Add(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "identify_error", err.Error())
		return
	}
	var req AddReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Quantity <= 0 {
		req.Quantity = 1
	}
	// Verify the variant exists + its product is active.
	var active bool
	err = h.db.QueryRow(r.Context(), `
        SELECT p.status = 'active'
        FROM variants v JOIN products p ON p.id = v.product_id
        WHERE v.id = $1
    `, req.VariantID).Scan(&active)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "variant_not_found", "variant not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if !active {
		httpx.Error(w, http.StatusConflict, "not_available", "product is not available for sale")
		return
	}

	_, err = h.db.Exec(r.Context(), `
        INSERT INTO cart_items (cart_id, variant_id, quantity)
        VALUES ($1, $2, $3)
        ON CONFLICT (cart_id, variant_id)
        DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
    `, cartID, req.VariantID, req.Quantity)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	_, _ = h.db.Exec(r.Context(), `UPDATE carts SET updated_at = now() WHERE id = $1`, cartID)

	cart, err := h.load(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

type UpdateReq struct {
	Quantity int `json:"quantity"`
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "identify_error", err.Error())
		return
	}
	itemID := chi.URLParam(r, "itemId")
	var req UpdateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Quantity <= 0 {
		_, err = h.db.Exec(r.Context(),
			`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, itemID, cartID)
	} else {
		_, err = h.db.Exec(r.Context(),
			`UPDATE cart_items SET quantity = $1 WHERE id = $2 AND cart_id = $3`,
			req.Quantity, itemID, cartID)
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	_, _ = h.db.Exec(r.Context(), `UPDATE carts SET updated_at = now() WHERE id = $1`, cartID)

	cart, err := h.load(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

func (h *Handler) Remove(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "identify_error", err.Error())
		return
	}
	itemID := chi.URLParam(r, "itemId")
	_, err = h.db.Exec(r.Context(),
		`DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, itemID, cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	_, _ = h.db.Exec(r.Context(), `UPDATE carts SET updated_at = now() WHERE id = $1`, cartID)

	cart, err := h.load(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

func (h *Handler) Clear(w http.ResponseWriter, r *http.Request) {
	cartID, err := h.identify(w, r)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "identify_error", err.Error())
		return
	}
	_, err = h.db.Exec(r.Context(),
		`DELETE FROM cart_items WHERE cart_id = $1`, cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	cart, err := h.load(r.Context(), cartID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, cart)
}

// ─── Load / project ──────────────────────────────────────────────────────

func (h *Handler) load(ctx context.Context, cartID string) (*Cart, error) {
	c := &Cart{Items: []Item{}}
	var customerID *string
	var discountCode *string
	err := h.db.QueryRow(ctx, `
        SELECT id, customer_id, currency, created_at, updated_at, discount_code
        FROM carts WHERE id = $1
    `, cartID).Scan(&c.ID, &customerID, &c.Currency, &c.CreatedAt, &c.UpdatedAt, &discountCode)
	if err != nil {
		return nil, err
	}
	c.CustomerID = customerID
	if discountCode != nil {
		c.DiscountCode = *discountCode
	}

	rows, err := h.db.Query(ctx, `
        SELECT ci.id, ci.variant_id, ci.quantity, ci.added_at,
               p.handle, p.title,
               COALESCE(
                   (SELECT string_agg(ov.value, ' / ' ORDER BY po.position)
                    FROM variant_option_values vov
                    JOIN option_values ov ON ov.id = vov.value_id
                    JOIN product_options po ON po.id = vov.option_id
                    WHERE vov.variant_id = v.id),
                   ''
               ) AS variant_title,
               v.sku, v.price_cents,
               p.status = 'active' AS available,
               COALESCE(
                   (SELECT url FROM product_media WHERE product_id = p.id ORDER BY position LIMIT 1),
                   ''
               ) AS image_url
        FROM cart_items ci
        JOIN variants v  ON v.id = ci.variant_id
        JOIN products p  ON p.id = v.product_id
        WHERE ci.cart_id = $1
        ORDER BY ci.added_at DESC
    `, cartID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var it Item
		if err := rows.Scan(&it.ID, &it.VariantID, &it.Quantity, &it.AddedAt,
			&it.ProductHandle, &it.ProductTitle, &it.VariantTitle, &it.SKU,
			&it.UnitPriceCents, &it.Available, &it.ImageURL); err != nil {
			return nil, err
		}
		it.LineTotalCents = it.UnitPriceCents * it.Quantity
		c.Items = append(c.Items, it)
		c.SubtotalCents += it.LineTotalCents
		c.TotalQuantity += it.Quantity
	}
	return c, nil
}

// uuidString turns pgtype.UUID bytes into a canonical 36-char representation.
// Imported by customer/admin handlers already; duplicated here to keep the
// package standalone.
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
