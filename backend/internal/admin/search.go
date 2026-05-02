package admin

import (
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SearchHandler powers the admin command palette (⌘K). One endpoint, one
// query string, parallel queries against products / customers / orders.
//
// Each kind is capped at a small N (5) so the round-trip stays fast even
// when the term is broad ("a"). The frontend renders sections by `kind`.
//
// Ranking blends pg_trgm similarity() with ILIKE substring matching:
//   - ILIKE catches exact substrings (covers prefix / contains).
//   - The `%` operator (default similarity_threshold 0.3) catches close
//     misspellings, e.g. "prdouct" matches "product".
//   - similarity() is used purely for ordering: rows with closer trigram
//     distance bubble up first, then we tie-break on the existing recency.
type SearchHandler struct{ db *pgxpool.Pool }

func NewSearchHandler(db *pgxpool.Pool) *SearchHandler { return &SearchHandler{db: db} }

type SearchHit struct {
	Kind     string `json:"kind"`     // "product" | "customer" | "order"
	ID       string `json:"id"`
	Title    string `json:"title"`    // primary label
	Subtitle string `json:"subtitle"` // secondary line (handle, email, total, …)
	Href     string `json:"href"`     // admin route to navigate to
}

func (h *SearchHandler) Search(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		httpx.JSON(w, http.StatusOK, map[string]any{"items": []SearchHit{}})
		return
	}
	// ILIKE pattern: prefix-match for short strings, contains for longer.
	// `%q%` everywhere is fine for a single-shop DB; we cap each kind at 5.
	pat := "%" + q + "%"
	hits := []SearchHit{}

	// Products
	if rows, err := h.db.Query(r.Context(), `
        SELECT id, title, handle, status,
               GREATEST(
                 similarity(title, $2),
                 similarity(handle, $2),
                 similarity(COALESCE(vendor,''), $2),
                 similarity(COALESCE(product_type,''), $2)
               ) AS score
        FROM products
        WHERE title ILIKE $1 OR handle ILIKE $1 OR vendor ILIKE $1 OR product_type ILIKE $1
           OR title % $2 OR handle % $2
        ORDER BY score DESC, updated_at DESC
        LIMIT 5
    `, pat, q); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, title, handle, status string
			var score float32
			if err := rows.Scan(&id, &title, &handle, &status, &score); err == nil {
				hits = append(hits, SearchHit{
					Kind: "product", ID: id, Title: title,
					Subtitle: handle + " · " + status,
					Href:     "/products/" + id,
				})
			}
		}
	}

	// Customers
	if rows, err := h.db.Query(r.Context(), `
        SELECT id, email, first_name, last_name, phone,
               GREATEST(
                 similarity(email, $2),
                 similarity(first_name || ' ' || last_name, $2),
                 similarity(COALESCE(phone,''), $2)
               ) AS score
        FROM customers
        WHERE email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1
           OR email % $2 OR (first_name || ' ' || last_name) % $2
        ORDER BY score DESC, updated_at DESC
        LIMIT 5
    `, pat, q); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, email, fn, ln, phone string
			var score float32
			if err := rows.Scan(&id, &email, &fn, &ln, &phone, &score); err == nil {
				name := strings.TrimSpace(fn + " " + ln)
				if name == "" {
					name = email
				}
				sub := email
				if phone != "" {
					sub = email + " · " + phone
				}
				hits = append(hits, SearchHit{
					Kind: "customer", ID: id, Title: name, Subtitle: sub,
					Href: "/customers/" + id,
				})
			}
		}
	}

	// Orders
	if rows, err := h.db.Query(r.Context(), `
        SELECT id, number, email, currency, total_cents, financial_status,
               GREATEST(
                 similarity(number, $2),
                 similarity(email, $2)
               ) AS score
        FROM orders
        WHERE number ILIKE $1 OR email ILIKE $1
           OR number % $2 OR email % $2
        ORDER BY score DESC, created_at DESC
        LIMIT 5
    `, pat, q); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, number, email, ccy, fin string
			var totalCents int
			var score float32
			if err := rows.Scan(&id, &number, &email, &ccy, &totalCents, &fin, &score); err == nil {
				hits = append(hits, SearchHit{
					Kind: "order", ID: id, Title: number,
					Subtitle: email + " · " + fin,
					Href:     "/orders/" + id,
				})
			}
		}
	}

	httpx.JSON(w, http.StatusOK, map[string]any{"items": hits})
}
