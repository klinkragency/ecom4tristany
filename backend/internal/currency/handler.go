// Package currency owns the active-currencies table + the read APIs the
// storefront + admin UI need. This is DISPLAY-only for now: prices are
// still persisted and charged in the shop's base currency, the storefront
// converts them to the buyer's selected currency at render time.
//
// Swapping this to full multi-currency checkout later means:
//   - persisting the active currency + rate snapshot on each order
//   - per-currency Stripe Payment Intents
//   - reconciling payouts in each currency
// …none of which is here yet.
package currency

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct{ db *pgxpool.Pool }

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

type Currency struct {
	Code           string    `json:"code"`
	Symbol         string    `json:"symbol"`
	SymbolPosition string    `json:"symbolPosition"`
	DecimalPlaces  int       `json:"decimalPlaces"`
	ExchangeRate   float64   `json:"exchangeRate"`
	Active         bool      `json:"active"`
	IsBase         bool      `json:"isBase"`
	Position       int       `json:"position"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type currencyInput struct {
	Code           string  `json:"code"`
	Symbol         string  `json:"symbol"`
	SymbolPosition string  `json:"symbolPosition"`
	DecimalPlaces  int     `json:"decimalPlaces"`
	ExchangeRate   float64 `json:"exchangeRate"`
	Active         bool    `json:"active"`
	IsBase         bool    `json:"isBase"`
	Position       int     `json:"position"`
}

// ─── Admin ──────────────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), listSQL())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Currency{}
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, *c)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

// Upsert by code. One endpoint handles create + update — admins think
// "what are the settings for USD?", not "does a row exist yet?".
func (h *Handler) Upsert(w http.ResponseWriter, r *http.Request) {
	var req currencyInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validate(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// If this row is marked is_base, clear the flag on every other row
	// first so the partial unique index stays happy.
	if req.IsBase {
		if _, err := tx.Exec(r.Context(),
			`UPDATE currencies SET is_base = false WHERE code <> $1`, req.Code); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "base_clear", err.Error())
			return
		}
		// The base currency's exchange rate is always 1 by definition.
		req.ExchangeRate = 1
	}

	_, err = tx.Exec(r.Context(), `
        INSERT INTO currencies
          (code, symbol, symbol_position, decimal_places, exchange_rate, active, is_base, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (code) DO UPDATE SET
          symbol = EXCLUDED.symbol,
          symbol_position = EXCLUDED.symbol_position,
          decimal_places = EXCLUDED.decimal_places,
          exchange_rate = EXCLUDED.exchange_rate,
          active = EXCLUDED.active,
          is_base = EXCLUDED.is_base,
          position = EXCLUDED.position,
          updated_at = now()
    `, req.Code, req.Symbol, req.SymbolPosition, req.DecimalPlaces,
		req.ExchangeRate, req.Active, req.IsBase, req.Position)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "upsert_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	code := strings.ToUpper(chi.URLParam(r, "code"))
	// Refuse to delete the base currency — everything depends on it.
	var isBase bool
	_ = h.db.QueryRow(r.Context(),
		`SELECT is_base FROM currencies WHERE code = $1`, code).Scan(&isBase)
	if isBase {
		httpx.Error(w, http.StatusConflict, "base_currency",
			"cannot delete the base currency — promote another first")
		return
	}
	res, err := h.db.Exec(r.Context(),
		`DELETE FROM currencies WHERE code = $1`, code)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "currency not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Storefront (public, active only) ───────────────────────────────────

// StorefrontList returns all active currencies sorted by position. The
// storefront needs this on every layout render to populate the switcher +
// convert prices, so we keep the payload small.
func (h *Handler) StorefrontList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT code, symbol, symbol_position, decimal_places, exchange_rate,
               active, is_base, position, updated_at
        FROM currencies WHERE active = true
        ORDER BY is_base DESC, position, code
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Currency{}
	for rows.Next() {
		c, err := scan(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, *c)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

// ─── Helpers ────────────────────────────────────────────────────────────

func listSQL() string {
	return `SELECT code, symbol, symbol_position, decimal_places, exchange_rate,
                   active, is_base, position, updated_at
            FROM currencies ORDER BY is_base DESC, position, code`
}

func scan(row pgx.Row) (*Currency, error) {
	var c Currency
	err := row.Scan(&c.Code, &c.Symbol, &c.SymbolPosition, &c.DecimalPlaces,
		&c.ExchangeRate, &c.Active, &c.IsBase, &c.Position, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func validate(r *currencyInput) error {
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	if len(r.Code) != 3 {
		return errors.New("code must be ISO 4217 (3 letters)")
	}
	if r.Symbol == "" {
		return errors.New("symbol required")
	}
	if r.SymbolPosition == "" {
		r.SymbolPosition = "after"
	}
	if r.SymbolPosition != "before" && r.SymbolPosition != "after" {
		return errors.New("symbolPosition must be 'before' or 'after'")
	}
	if r.DecimalPlaces < 0 || r.DecimalPlaces > 4 {
		return errors.New("decimalPlaces must be 0-4")
	}
	if r.ExchangeRate <= 0 {
		return errors.New("exchangeRate must be > 0")
	}
	return nil
}
