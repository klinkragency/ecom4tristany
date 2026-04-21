// Package analytics owns the event pipeline (ingest + session tracking) and
// the admin-facing dashboard/finance queries.
//
// Design notes:
//
//   - One anonymous session cookie (`__Host-anon_sid`) is set on first
//     visit and is the primary "funnel" key. When a customer signs in we
//     UPSERT the session row so subsequent events span the login boundary.
//   - All storefront-originated events come through one ingest endpoint.
//     Server-side events (order_paid, order_refunded) are written directly
//     by the handlers that know the transition happened.
//   - The ingest endpoint is CSRF-exempt: it's read-only from a causation
//     standpoint (can't change state, can't leak PII) and tracking scripts
//     historically don't carry CSRF tokens. It IS rate-limited per IP.
//   - Payload is JSONB and deliberately schemaless — the event kind defines
//     which payload keys are meaningful.
package analytics

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/geo"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Cookie name for the anonymous tracking session. We use the same __Host-
// prefix as our auth cookies so browsers enforce Secure + Path=/.
const SessionCookie = "__Host-anon_sid"

// Event kinds the ingest endpoint accepts. Listed here (rather than free-
// form) so typos in the storefront don't silently poison analytics tables.
var validKinds = map[string]bool{
	"page_view":          true,
	"product_view":       true,
	"collection_view":    true,
	"search":             true,
	"cart_add":           true,
	"cart_remove":        true,
	"cart_update":        true,
	"checkout_started":   true,
	"checkout_completed": true, // storefront-emitted, payload includes orderId
	// order_paid, order_refunded, order_cancelled — written server-side from
	// the webhook/admin handlers using WriteServerEvent(). Listed here so
	// the admin dashboards can safely query by kind.
	"order_paid":      true,
	"order_refunded":  true,
	"order_cancelled": true,
}

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── Cookie middleware ──────────────────────────────────────────────────

// SessionMiddleware ensures every storefront request has an anon_sid
// cookie set. We mint the ID lazily and persist the row only on first
// actual event (to avoid a write per page load from crawlers).
func SessionMiddleware(dev bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if _, err := r.Cookie(SessionCookie); err != nil {
				token, tokErr := newSessionID()
				if tokErr == nil {
					http.SetCookie(w, &http.Cookie{
						Name:     SessionCookie,
						Value:    token,
						Path:     "/",
						HttpOnly: false, // tracker reads it client-side
						Secure:   !dev,
						SameSite: http.SameSiteLaxMode,
						MaxAge:   60 * 60 * 24 * 365,
					})
					// Attach to the context so downstream handlers can use it
					// on first event before the client sees the cookie back.
					r = r.WithContext(context.WithValue(r.Context(), ctxKeySID{}, token))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

type ctxKeySID struct{}

// ─── Ingest ─────────────────────────────────────────────────────────────

type TrackReq struct {
	Kind      string                 `json:"kind"`
	ProductID string                 `json:"productId,omitempty"`
	VariantID string                 `json:"variantId,omitempty"`
	CartID    string                 `json:"cartId,omitempty"`
	OrderID   string                 `json:"orderId,omitempty"`
	URL       string                 `json:"url,omitempty"`
	Referrer  string                 `json:"referrer,omitempty"`
	Payload   map[string]any         `json:"payload,omitempty"`
}

// Track records a single event. Fire-and-forget semantics: we don't surface
// DB errors to the caller beyond a 4xx for bad input — metrics must never
// break page loads.
func (h *Handler) Track(w http.ResponseWriter, r *http.Request) {
	var req TrackReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if !validKinds[req.Kind] {
		httpx.Error(w, http.StatusBadRequest, "invalid_kind", "unknown event kind")
		return
	}
	// server-only kinds must not be emitted from the browser
	if req.Kind == "order_paid" || req.Kind == "order_refunded" || req.Kind == "order_cancelled" {
		httpx.Error(w, http.StatusForbidden, "kind_not_allowed",
			"this event kind is written server-side only")
		return
	}

	sid := sessionID(r)
	if sid == "" {
		// Shouldn't happen with SessionMiddleware in place; create one here
		// as a fallback so the event still lands.
		t, err := newSessionID()
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "sid_error", err.Error())
			return
		}
		sid = t
	}

	// Attach customer_id if the buyer is authenticated.
	var customerID *string
	if sess, ok := auth.SessionFromContext(r.Context()); ok && sess.UserType == session.TypeCustomer {
		cid := uuidString(sess.UserID.Bytes)
		customerID = &cid
	}

	// Detect country from Cloudflare / proxy headers, or fall back to the
	// Accept-Language region. Stored on the row once; later events don't
	// overwrite it — a VPN switch mid-session shouldn't flip the origin.
	country := geo.DetectCountry(r)

	// Upsert the session row on the first event so we can join analytics to
	// customers / orders and compute cohorts.
	if _, err := h.db.Exec(r.Context(), `
        INSERT INTO analytics_sessions (id, customer_id, ip_first, user_agent, country)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          last_seen = now(),
          customer_id = COALESCE(analytics_sessions.customer_id, EXCLUDED.customer_id)
    `, sid, customerID, clientIP(r), r.UserAgent(), country); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session_upsert", err.Error())
		return
	}

	// Resolve the cart for this request (so cart events are properly linked).
	cartID := nonEmptyOrNil(req.CartID)
	if cartID == nil {
		if c, err := r.Cookie("cart_token"); err == nil && c.Value != "" {
			var cid string
			_ = h.db.QueryRow(r.Context(),
				`SELECT id FROM carts WHERE token = $1`, c.Value).Scan(&cid)
			if cid != "" {
				cartID = &cid
			}
		}
	}

	if _, err := h.db.Exec(r.Context(), `
        INSERT INTO analytics_events (
          kind, session_id, customer_id, cart_id, order_id, product_id, variant_id,
          url, referrer, user_agent, ip, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, '{}'::jsonb))
    `, req.Kind, sid, customerID, cartID,
		nonEmptyOrNil(req.OrderID), nonEmptyOrNil(req.ProductID), nonEmptyOrNil(req.VariantID),
		req.URL, req.Referrer, r.UserAgent(), clientIP(r), req.Payload,
	); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "event_insert", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// WriteServerEvent is the internal API for handlers to record a state
// transition without going through the HTTP ingest (used by the Stripe
// webhook and admin cancel/refund flows). Best-effort — errors are logged
// by the caller but not returned (analytics must never block state
// transitions).
func WriteServerEvent(ctx context.Context, db *pgxpool.Pool, kind string, orderID, customerID *string, payload map[string]any) error {
	if !validKinds[kind] {
		return errors.New("unknown server event kind: " + kind)
	}
	if payload == nil {
		payload = map[string]any{}
	}
	_, err := db.Exec(ctx, `
        INSERT INTO analytics_events (kind, order_id, customer_id, payload)
        VALUES ($1, $2, $3, $4)
    `, kind, orderID, customerID, payload)
	return err
}

// ─── Helpers ────────────────────────────────────────────────────────────

func newSessionID() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func sessionID(r *http.Request) string {
	if v, ok := r.Context().Value(ctxKeySID{}).(string); ok && v != "" {
		return v
	}
	if c, err := r.Cookie(SessionCookie); err == nil {
		return c.Value
	}
	return ""
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		// Take the first entry (original client).
		if i := indexOf(xf, ','); i > 0 {
			return strings.TrimSpace(xf[:i])
		}
		return strings.TrimSpace(xf)
	}
	host := r.RemoteAddr
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

func indexOf(s string, c byte) int {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return i
		}
	}
	return -1
}

func nonEmptyOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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

// Silence unused-import errors when the engine is pared down in tests.
var _ = time.Second
var _ = pgx.ErrNoRows
