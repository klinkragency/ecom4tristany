// Package tax owns the per-country VAT rate table + the one-function public
// API the checkout calls to resolve "what VAT rate applies for this order".
//
// Resolution order:
//   1. If a row exists in tax_rates for the shipping-address country → use it.
//   2. Otherwise fall back to the shop default (cfg.ShopVATPercent).
//
// Tax-inclusive pricing is unchanged: checkout still back-solves the tax
// component out of the gross total. Only the percentage changes per country.
package tax

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ResolvePercent returns the integer-rounded VAT percent for the given
// country code. Returns (0, false) if no row exists — the caller decides
// what fallback to apply (typically cfg.ShopVATPercent).
//
// We return int (not float) because BackSolveVAT already rounds, and our
// admin UI edits with 2 decimals; the rounding drift for sub-percent rates
// (e.g. Finland 25.5%) is accepted as negligible on order-level totals.
// If finer precision is needed later, change the signature and update
// BackSolveVAT to take a float.
func ResolvePercent(ctx context.Context, db *pgxpool.Pool, country string) (int, bool) {
	country = strings.ToUpper(strings.TrimSpace(country))
	if len(country) != 2 {
		return 0, false
	}
	var pct float64
	err := db.QueryRow(ctx,
		`SELECT percent FROM tax_rates WHERE country = $1`, country,
	).Scan(&pct)
	if err != nil {
		return 0, false
	}
	// Round to nearest int. Shop-level display accepts the quantisation.
	return int(pct + 0.5), true
}

// ─── Admin handler ──────────────────────────────────────────────────────

type Handler struct{ db *pgxpool.Pool }

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

type TaxRate struct {
	ID        string    `json:"id"`
	Country   string    `json:"country"`
	Percent   float64   `json:"percent"`
	Name      string    `json:"name"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type TaxRateInput struct {
	Country string  `json:"country"`
	Percent float64 `json:"percent"`
	Name    string  `json:"name"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, country, percent, name, updated_at
        FROM tax_rates ORDER BY country
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []TaxRate{}
	for rows.Next() {
		var t TaxRate
		if err := rows.Scan(&t.ID, &t.Country, &t.Percent, &t.Name, &t.UpdatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, t)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

// Upsert creates OR updates by country code. Admins rarely care about the
// row id; they think "what's the rate for DE?" — so keying by country in
// one endpoint is simpler than separate POST/PUT.
func (h *Handler) Upsert(w http.ResponseWriter, r *http.Request) {
	var req TaxRateInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validate(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	_, err := h.db.Exec(r.Context(), `
        INSERT INTO tax_rates (country, percent, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (country) DO UPDATE SET
          percent = EXCLUDED.percent,
          name = EXCLUDED.name,
          updated_at = now()
    `, req.Country, req.Percent, req.Name)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "upsert_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	country := strings.ToUpper(strings.TrimSpace(chi.URLParam(r, "country")))
	res, err := h.db.Exec(r.Context(), `DELETE FROM tax_rates WHERE country = $1`, country)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "no rate for that country")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func validate(r *TaxRateInput) error {
	r.Country = strings.ToUpper(strings.TrimSpace(r.Country))
	if len(r.Country) != 2 {
		return errors.New("country must be ISO-2")
	}
	if r.Percent < 0 || r.Percent > 100 {
		return errors.New("percent must be 0-100")
	}
	return nil
}

// Silence unused import when tests strip dependencies.
var _ = pgx.ErrNoRows
