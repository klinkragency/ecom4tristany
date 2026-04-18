package inventory

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ─── Locations CRUD ──────────────────────────────────────────────────────

func (h *Handler) ListLocations(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, name, is_active, is_fulfillment,
               address_line1, address_line2, city, region, postal_code, country, phone,
               created_at, updated_at
        FROM locations ORDER BY created_at
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Location{}
	for rows.Next() {
		var l Location
		if err := rows.Scan(&l.ID, &l.Name, &l.IsActive, &l.IsFulfillment,
			&l.AddressLine1, &l.AddressLine2, &l.City, &l.Region, &l.PostalCode, &l.Country, &l.Phone,
			&l.CreatedAt, &l.UpdatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, l)
	}
	httpx.JSON(w, http.StatusOK, out)
}

type LocationReq struct {
	Name          string `json:"name"`
	IsActive      *bool  `json:"isActive,omitempty"`
	IsFulfillment *bool  `json:"isFulfillment,omitempty"`
	AddressLine1  string `json:"addressLine1"`
	AddressLine2  string `json:"addressLine2"`
	City          string `json:"city"`
	Region        string `json:"region"`
	PostalCode    string `json:"postalCode"`
	Country       string `json:"country"`
	Phone         string `json:"phone"`
}

func (h *Handler) CreateLocation(w http.ResponseWriter, r *http.Request) {
	var req LocationReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	fulfillment := true
	if req.IsFulfillment != nil {
		fulfillment = *req.IsFulfillment
	}

	var id string
	err := h.db.QueryRow(r.Context(), `
        INSERT INTO locations (name, is_active, is_fulfillment,
                               address_line1, address_line2, city, region, postal_code, country, phone)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
    `, req.Name, active, fulfillment,
		req.AddressLine1, req.AddressLine2, req.City, req.Region, req.PostalCode, req.Country, req.Phone,
	).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	h.getLocation(w, r, id, http.StatusCreated)
}

func (h *Handler) UpdateLocation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req LocationReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	sets := []string{"updated_at = now()"}
	args := []any{id}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+strconv.Itoa(len(args)))
	}
	if req.Name != "" {
		add("name", req.Name)
	}
	if req.IsActive != nil {
		add("is_active", *req.IsActive)
	}
	if req.IsFulfillment != nil {
		add("is_fulfillment", *req.IsFulfillment)
	}
	add("address_line1", req.AddressLine1)
	add("address_line2", req.AddressLine2)
	add("city", req.City)
	add("region", req.Region)
	add("postal_code", req.PostalCode)
	add("country", req.Country)
	add("phone", req.Phone)

	res, err := h.db.Exec(r.Context(),
		"UPDATE locations SET "+strings.Join(sets, ", ")+" WHERE id = $1", args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "location not found")
		return
	}
	h.getLocation(w, r, id, http.StatusOK)
}

func (h *Handler) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	// Refuse if any inventory > 0 is stored here.
	var any int
	err := h.db.QueryRow(r.Context(),
		`SELECT COALESCE(SUM(on_hand), 0) FROM inventory_levels WHERE location_id = $1`, id,
	).Scan(&any)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if any > 0 {
		httpx.Error(w, http.StatusConflict, "has_stock",
			"cannot delete a location that still holds stock — transfer or adjust to 0 first")
		return
	}
	// Also refuse if transfers reference it.
	var refCount int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM stock_transfers WHERE from_location = $1 OR to_location = $1`, id,
	).Scan(&refCount); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if refCount > 0 {
		httpx.Error(w, http.StatusConflict, "has_transfers",
			"cannot delete a location referenced by transfers")
		return
	}

	// Count active locations; refuse deletion if this is the last one.
	var active int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM locations WHERE is_active`,
	).Scan(&active); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if active <= 1 {
		httpx.Error(w, http.StatusConflict, "last_location", "at least one active location is required")
		return
	}

	res, err := h.db.Exec(r.Context(), `DELETE FROM locations WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "location not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) getLocation(w http.ResponseWriter, r *http.Request, id string, status int) {
	var l Location
	err := h.db.QueryRow(r.Context(), `
        SELECT id, name, is_active, is_fulfillment,
               address_line1, address_line2, city, region, postal_code, country, phone,
               created_at, updated_at
        FROM locations WHERE id = $1
    `, id).Scan(&l.ID, &l.Name, &l.IsActive, &l.IsFulfillment,
		&l.AddressLine1, &l.AddressLine2, &l.City, &l.Region, &l.PostalCode, &l.Country, &l.Phone,
		&l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "location not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, status, l)
}
