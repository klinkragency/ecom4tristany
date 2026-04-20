// Package shipping provides admin CRUD for shipping zones/rates and a public
// helper to compute available rates for a given cart + destination country.
//
// Rate kinds:
//   - flat   : a fixed price
//   - weight : perKgCents × (totalWeightGrams / 1000), with an optional minimum
//
// Zones are lookup tables keyed by ISO-2 country code. A country can only
// belong to one zone (DB unique constraint), so resolving rates is a single
// lookup on country.
package shipping

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

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── DTOs ───────────────────────────────────────────────────────────────

type Zone struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Position  int       `json:"position"`
	Countries []string  `json:"countries"`
	Rates     []Rate    `json:"rates"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type Rate struct {
	ID            string `json:"id"`
	ZoneID        string `json:"zoneId"`
	Name          string `json:"name"`
	Kind          string `json:"kind"` // flat | weight
	FlatCents     int    `json:"flatCents"`
	PerKgCents    int    `json:"perKgCents"`
	MinCents      int    `json:"minCents"`
	FreeOverCents *int   `json:"freeOverCents,omitempty"`
	Active        bool   `json:"active"`
	Position      int    `json:"position"`
}

type ZoneInput struct {
	Name      string   `json:"name"`
	Position  int      `json:"position"`
	Countries []string `json:"countries"`
}

type RateInput struct {
	Name          string `json:"name"`
	Kind          string `json:"kind"`
	FlatCents     int    `json:"flatCents"`
	PerKgCents    int    `json:"perKgCents"`
	MinCents      int    `json:"minCents"`
	FreeOverCents *int   `json:"freeOverCents"`
	Active        bool   `json:"active"`
	Position      int    `json:"position"`
}

// ─── Zone CRUD ──────────────────────────────────────────────────────────

func (h *Handler) ListZones(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, name, position, created_at, updated_at
        FROM shipping_zones ORDER BY position, name
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	zones := []Zone{}
	for rows.Next() {
		var z Zone
		if err := rows.Scan(&z.ID, &z.Name, &z.Position, &z.CreatedAt, &z.UpdatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		z.Countries = []string{}
		z.Rates = []Rate{}
		zones = append(zones, z)
	}
	for i := range zones {
		if err := attachZoneData(r.Context(), h.db, &zones[i]); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "attach_error", err.Error())
			return
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": zones})
}

func (h *Handler) GetZone(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	z, err := loadZone(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "zone not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, z)
}

func (h *Handler) CreateZone(w http.ResponseWriter, r *http.Request) {
	var req ZoneInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	if err := tx.QueryRow(r.Context(),
		`INSERT INTO shipping_zones (name, position) VALUES ($1, $2) RETURNING id`,
		req.Name, req.Position,
	).Scan(&id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	if err := writeZoneCountries(r.Context(), tx, id, req.Countries); err != nil {
		httpx.Error(w, http.StatusBadRequest, "country_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	z, _ := loadZone(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusCreated, z)
}

func (h *Handler) UpdateZone(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req ZoneInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	res, err := tx.Exec(r.Context(), `
        UPDATE shipping_zones SET name = $1, position = $2, updated_at = now()
        WHERE id = $3
    `, req.Name, req.Position, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "zone not found")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM shipping_zone_countries WHERE zone_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_error", err.Error())
		return
	}
	if err := writeZoneCountries(r.Context(), tx, id, req.Countries); err != nil {
		httpx.Error(w, http.StatusBadRequest, "country_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	z, _ := loadZone(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusOK, z)
}

func (h *Handler) DeleteZone(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM shipping_zones WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "zone not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Rate CRUD ──────────────────────────────────────────────────────────

func (h *Handler) CreateRate(w http.ResponseWriter, r *http.Request) {
	zoneID := chi.URLParam(r, "zoneId")
	var req RateInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateRate(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_rate", err.Error())
		return
	}
	var id string
	err := h.db.QueryRow(r.Context(), `
        INSERT INTO shipping_rates
          (zone_id, name, kind, flat_cents, per_kg_cents, min_cents, free_over_cents, active, position)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id
    `, zoneID, req.Name, req.Kind, req.FlatCents, req.PerKgCents, req.MinCents,
		req.FreeOverCents, req.Active, req.Position).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	rate, _ := loadRate(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusCreated, rate)
}

func (h *Handler) UpdateRate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req RateInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateRate(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_rate", err.Error())
		return
	}
	res, err := h.db.Exec(r.Context(), `
        UPDATE shipping_rates SET
          name = $1, kind = $2,
          flat_cents = $3, per_kg_cents = $4, min_cents = $5,
          free_over_cents = $6, active = $7, position = $8,
          updated_at = now()
        WHERE id = $9
    `, req.Name, req.Kind, req.FlatCents, req.PerKgCents, req.MinCents,
		req.FreeOverCents, req.Active, req.Position, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "rate not found")
		return
	}
	rate, _ := loadRate(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusOK, rate)
}

func (h *Handler) DeleteRate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM shipping_rates WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "rate not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func validateRate(r *RateInput) error {
	r.Name = strings.TrimSpace(r.Name)
	if r.Name == "" {
		return errors.New("name required")
	}
	switch r.Kind {
	case "flat", "weight":
	default:
		return errors.New("kind must be 'flat' or 'weight'")
	}
	if r.FlatCents < 0 || r.PerKgCents < 0 || r.MinCents < 0 {
		return errors.New("cents values must be non-negative")
	}
	if r.FreeOverCents != nil && *r.FreeOverCents < 0 {
		return errors.New("freeOverCents must be non-negative")
	}
	return nil
}

func writeZoneCountries(ctx context.Context, tx pgx.Tx, zoneID string, countries []string) error {
	seen := map[string]struct{}{}
	for _, c := range countries {
		c = strings.ToUpper(strings.TrimSpace(c))
		if len(c) != 2 {
			return errors.New("country codes must be ISO-2 (e.g. FR, DE)")
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		if _, err := tx.Exec(ctx,
			`INSERT INTO shipping_zone_countries (zone_id, country) VALUES ($1, $2)`,
			zoneID, c); err != nil {
			// Most common failure: UNIQUE on country (already in another zone).
			return errors.New("country " + c + " already belongs to another zone")
		}
	}
	return nil
}

func loadZone(ctx context.Context, db *pgxpool.Pool, id string) (*Zone, error) {
	var z Zone
	err := db.QueryRow(ctx, `
        SELECT id, name, position, created_at, updated_at
        FROM shipping_zones WHERE id = $1
    `, id).Scan(&z.ID, &z.Name, &z.Position, &z.CreatedAt, &z.UpdatedAt)
	if err != nil {
		return nil, err
	}
	z.Countries = []string{}
	z.Rates = []Rate{}
	if err := attachZoneData(ctx, db, &z); err != nil {
		return nil, err
	}
	return &z, nil
}

func attachZoneData(ctx context.Context, db *pgxpool.Pool, z *Zone) error {
	crows, err := db.Query(ctx,
		`SELECT country FROM shipping_zone_countries WHERE zone_id = $1 ORDER BY country`, z.ID)
	if err != nil {
		return err
	}
	for crows.Next() {
		var c string
		if err := crows.Scan(&c); err != nil {
			crows.Close()
			return err
		}
		z.Countries = append(z.Countries, c)
	}
	crows.Close()

	rrows, err := db.Query(ctx, `
        SELECT id, zone_id, name, kind, flat_cents, per_kg_cents, min_cents,
               free_over_cents, active, position
        FROM shipping_rates WHERE zone_id = $1 ORDER BY position, name
    `, z.ID)
	if err != nil {
		return err
	}
	for rrows.Next() {
		var r Rate
		if err := rrows.Scan(&r.ID, &r.ZoneID, &r.Name, &r.Kind, &r.FlatCents,
			&r.PerKgCents, &r.MinCents, &r.FreeOverCents, &r.Active, &r.Position); err != nil {
			rrows.Close()
			return err
		}
		z.Rates = append(z.Rates, r)
	}
	rrows.Close()
	return nil
}

func loadRate(ctx context.Context, db *pgxpool.Pool, id string) (*Rate, error) {
	var r Rate
	err := db.QueryRow(ctx, `
        SELECT id, zone_id, name, kind, flat_cents, per_kg_cents, min_cents,
               free_over_cents, active, position
        FROM shipping_rates WHERE id = $1
    `, id).Scan(&r.ID, &r.ZoneID, &r.Name, &r.Kind, &r.FlatCents,
		&r.PerKgCents, &r.MinCents, &r.FreeOverCents, &r.Active, &r.Position)
	if err != nil {
		return nil, err
	}
	return &r, nil
}
