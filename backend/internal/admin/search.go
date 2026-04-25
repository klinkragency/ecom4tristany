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
        SELECT id, title, handle, status
        FROM products
        WHERE title ILIKE $1 OR handle ILIKE $1 OR vendor ILIKE $1 OR product_type ILIKE $1
        ORDER BY updated_at DESC LIMIT 5
    `, pat); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, title, handle, status string
			if err := rows.Scan(&id, &title, &handle, &status); err == nil {
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
        SELECT id, email, first_name, last_name, phone
        FROM customers
        WHERE email ILIKE $1 OR first_name ILIKE $1 OR last_name ILIKE $1 OR phone ILIKE $1
        ORDER BY updated_at DESC LIMIT 5
    `, pat); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, email, fn, ln, phone string
			if err := rows.Scan(&id, &email, &fn, &ln, &phone); err == nil {
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
        SELECT id, number, email, currency, total_cents, financial_status
        FROM orders
        WHERE number ILIKE $1 OR email ILIKE $1
        ORDER BY created_at DESC LIMIT 5
    `, pat); err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, number, email, ccy, fin string
			var totalCents int
			if err := rows.Scan(&id, &number, &email, &ccy, &totalCents, &fin); err == nil {
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
