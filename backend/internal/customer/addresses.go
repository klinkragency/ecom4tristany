package customer

import (
	"errors"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type Address struct {
	ID                string `json:"id"`
	Label             string `json:"label"`
	FirstName         string `json:"firstName"`
	LastName          string `json:"lastName"`
	Company           string `json:"company"`
	AddressLine1      string `json:"addressLine1"`
	AddressLine2      string `json:"addressLine2"`
	City              string `json:"city"`
	Region            string `json:"region"`
	PostalCode        string `json:"postalCode"`
	Country           string `json:"country"`
	Phone             string `json:"phone"`
	IsDefaultShipping bool   `json:"isDefaultShipping"`
	IsDefaultBilling  bool   `json:"isDefaultBilling"`
}

type AddressReq struct {
	Label             string `json:"label"`
	FirstName         string `json:"firstName"`
	LastName          string `json:"lastName"`
	Company           string `json:"company"`
	AddressLine1      string `json:"addressLine1"`
	AddressLine2      string `json:"addressLine2"`
	City              string `json:"city"`
	Region            string `json:"region"`
	PostalCode        string `json:"postalCode"`
	Country           string `json:"country"`
	Phone             string `json:"phone"`
	IsDefaultShipping bool   `json:"isDefaultShipping"`
	IsDefaultBilling  bool   `json:"isDefaultBilling"`
}

func (h *Handler) ListAddresses(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	rows, err := h.db.Query(r.Context(), `
        SELECT id, label, first_name, last_name, company, address_line1, address_line2,
               city, region, postal_code, country, phone,
               is_default_shipping, is_default_billing
        FROM customer_addresses
        WHERE customer_id = $1
        ORDER BY is_default_shipping DESC, is_default_billing DESC, created_at
    `, cid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Address{}
	for rows.Next() {
		var a Address
		if err := rows.Scan(&a.ID, &a.Label, &a.FirstName, &a.LastName, &a.Company,
			&a.AddressLine1, &a.AddressLine2, &a.City, &a.Region, &a.PostalCode,
			&a.Country, &a.Phone, &a.IsDefaultShipping, &a.IsDefaultBilling); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, a)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) CreateAddress(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var req AddressReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateAddress(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if err := clearDefaults(r, tx, cid, req.IsDefaultShipping, req.IsDefaultBilling); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_defaults", err.Error())
		return
	}
	var id string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO customer_addresses (customer_id, label, first_name, last_name, company,
                                        address_line1, address_line2, city, region, postal_code,
                                        country, phone, is_default_shipping, is_default_billing)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id
    `, cid, req.Label, req.FirstName, req.LastName, req.Company,
		req.AddressLine1, req.AddressLine2, req.City, req.Region, req.PostalCode,
		req.Country, req.Phone, req.IsDefaultShipping, req.IsDefaultBilling).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	h.getAddress(w, r, cid, id, http.StatusCreated)
}

func (h *Handler) UpdateAddress(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	var req AddressReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateAddress(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	if err := clearDefaults(r, tx, cid, req.IsDefaultShipping, req.IsDefaultBilling); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_defaults", err.Error())
		return
	}
	res, err := tx.Exec(r.Context(), `
        UPDATE customer_addresses SET
          label = $1, first_name = $2, last_name = $3, company = $4,
          address_line1 = $5, address_line2 = $6, city = $7, region = $8,
          postal_code = $9, country = $10, phone = $11,
          is_default_shipping = $12, is_default_billing = $13,
          updated_at = now()
        WHERE id = $14 AND customer_id = $15
    `, req.Label, req.FirstName, req.LastName, req.Company,
		req.AddressLine1, req.AddressLine2, req.City, req.Region, req.PostalCode,
		req.Country, req.Phone, req.IsDefaultShipping, req.IsDefaultBilling,
		id, cid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "address not found")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	h.getAddress(w, r, cid, id, http.StatusOK)
}

func (h *Handler) DeleteAddress(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(),
		`DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2`, id, cid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "address not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) getAddress(w http.ResponseWriter, r *http.Request, cid, id string, status int) {
	var a Address
	err := h.db.QueryRow(r.Context(), `
        SELECT id, label, first_name, last_name, company, address_line1, address_line2,
               city, region, postal_code, country, phone, is_default_shipping, is_default_billing
        FROM customer_addresses WHERE id = $1 AND customer_id = $2
    `, id, cid).Scan(&a.ID, &a.Label, &a.FirstName, &a.LastName, &a.Company,
		&a.AddressLine1, &a.AddressLine2, &a.City, &a.Region, &a.PostalCode,
		&a.Country, &a.Phone, &a.IsDefaultShipping, &a.IsDefaultBilling)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "address not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, status, a)
}

// clearDefaults drops existing default flags when a new address claims them.
func clearDefaults(r *http.Request, tx pgx.Tx, cid string, defaultShipping, defaultBilling bool) error {
	if defaultShipping {
		if _, err := tx.Exec(r.Context(),
			`UPDATE customer_addresses SET is_default_shipping = false WHERE customer_id = $1`, cid); err != nil {
			return err
		}
	}
	if defaultBilling {
		if _, err := tx.Exec(r.Context(),
			`UPDATE customer_addresses SET is_default_billing = false WHERE customer_id = $1`, cid); err != nil {
			return err
		}
	}
	return nil
}

func validateAddress(a *AddressReq) error {
	if strings.TrimSpace(a.FirstName) == "" || strings.TrimSpace(a.LastName) == "" {
		return errors.New("first and last name required")
	}
	if strings.TrimSpace(a.AddressLine1) == "" || strings.TrimSpace(a.City) == "" ||
		strings.TrimSpace(a.PostalCode) == "" || strings.TrimSpace(a.Country) == "" {
		return errors.New("address line 1, city, postal code and country required")
	}
	if len(a.Country) != 2 {
		return errors.New("country must be 2-letter ISO code")
	}
	a.Country = strings.ToUpper(a.Country)
	return nil
}

// customerID returns the authenticated customer's ID. Must be called from
// endpoints that are behind RequireCustomer middleware.
func customerID(r *http.Request) (string, bool) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok || !sess.UserID.Valid {
		return "", false
	}
	return uuidString(sess.UserID), true
}
