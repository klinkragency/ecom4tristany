package product

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/storage"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db      *pgxpool.Pool
	storage storage.Storage
}

func NewHandler(db *pgxpool.Pool, s storage.Storage) *Handler {
	return &Handler{db: db, storage: s}
}

// ─── Products ────────────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, err := List(r.Context(), h.db, ListParams{
		Search:      q.Get("q"),
		Status:      q.Get("status"),
		Tag:         q.Get("tag"),
		Vendor:      q.Get("vendor"),
		ProductType: q.Get("type"),
		Limit:       limit,
		Cursor:      q.Get("cursor"),
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "list_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, page)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	p, err := LoadByID(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

type CreateReq struct {
	Title           string   `json:"title"`
	Handle          string   `json:"handle"`
	DescriptionHTML string   `json:"descriptionHtml"`
	Status          string   `json:"status"`
	Vendor          string   `json:"vendor"`
	ProductType     string   `json:"productType"`
	Tags            []string `json:"tags"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_title", "title is required")
		return
	}
	if req.Status == "" {
		req.Status = "draft"
	}
	base := req.Handle
	if base == "" {
		base = req.Title
	}
	handle, err := uniqueHandle(r.Context(), h.db, base, "")
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "handle_error", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO products (handle, title, description_html, status, vendor, product_type)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
    `, handle, req.Title, req.DescriptionHTML, req.Status, req.Vendor, req.ProductType).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	// Default variant (no options yet, price 0).
	_, err = tx.Exec(r.Context(), `
        INSERT INTO variants (product_id, price_cents, position) VALUES ($1, 0, 0)
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_variant_error", err.Error())
		return
	}

	for _, tag := range dedupTags(req.Tags) {
		_, err = tx.Exec(r.Context(),
			`INSERT INTO product_tags (product_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			id, tag)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "insert_tag_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	p, err := LoadByID(r.Context(), h.db, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, p)
}

type UpdateReq struct {
	Title           *string   `json:"title,omitempty"`
	Handle          *string   `json:"handle,omitempty"`
	DescriptionHTML *string   `json:"descriptionHtml,omitempty"`
	Status          *string   `json:"status,omitempty"`
	Vendor          *string   `json:"vendor,omitempty"`
	ProductType     *string   `json:"productType,omitempty"`
	TaxStatus       *string   `json:"taxStatus,omitempty"`
	WeightGrams     *int      `json:"weightGrams,omitempty"`
	HSCode          *string   `json:"hsCode,omitempty"`
	SEOTitle        *string   `json:"seoTitle,omitempty"`
	SEODescription  *string   `json:"seoDescription,omitempty"`
	Tags            *[]string `json:"tags,omitempty"`
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req UpdateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	sets := []string{"updated_at = now()"}
	args := []any{id}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+itoa(len(args)))
	}
	if req.Title != nil {
		add("title", *req.Title)
	}
	if req.DescriptionHTML != nil {
		add("description_html", *req.DescriptionHTML)
	}
	if req.Status != nil {
		if *req.Status != "draft" && *req.Status != "active" && *req.Status != "archived" {
			httpx.Error(w, http.StatusBadRequest, "invalid_status", "status must be draft|active|archived")
			return
		}
		add("status", *req.Status)
		if *req.Status == "active" {
			sets = append(sets, "published_at = COALESCE(published_at, now())")
		}
	}
	if req.Vendor != nil {
		add("vendor", *req.Vendor)
	}
	if req.ProductType != nil {
		add("product_type", *req.ProductType)
	}
	if req.TaxStatus != nil {
		if *req.TaxStatus != "taxable" && *req.TaxStatus != "non_taxable" {
			httpx.Error(w, http.StatusBadRequest, "invalid_tax_status", "taxStatus must be taxable|non_taxable")
			return
		}
		add("tax_status", *req.TaxStatus)
	}
	if req.WeightGrams != nil {
		add("weight_grams", *req.WeightGrams)
	}
	if req.HSCode != nil {
		add("hs_code", *req.HSCode)
	}
	if req.SEOTitle != nil {
		add("seo_title", *req.SEOTitle)
	}
	if req.SEODescription != nil {
		add("seo_description", *req.SEODescription)
	}
	if req.Handle != nil {
		newHandle, err := uniqueHandle(r.Context(), h.db, *req.Handle, id)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "handle_error", err.Error())
			return
		}
		add("handle", newHandle)
	}

	if len(sets) > 1 {
		_, err = tx.Exec(r.Context(),
			"UPDATE products SET "+strings.Join(sets, ", ")+" WHERE id = $1",
			args...)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
			return
		}
	}

	if req.Tags != nil {
		if _, err := tx.Exec(r.Context(), `DELETE FROM product_tags WHERE product_id = $1`, id); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "tag_clear", err.Error())
			return
		}
		for _, tag := range dedupTags(*req.Tags) {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO product_tags (product_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
				id, tag); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "tag_insert", err.Error())
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	p, err := LoadByID(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM products WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Options ─────────────────────────────────────────────────────────────

type OptionReq struct {
	Name   string   `json:"name"`
	Values []string `json:"values"`
}

func (h *Handler) AddOption(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req OptionReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "option name required")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var count int
	if err := tx.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM product_options WHERE product_id = $1`, pid).Scan(&count); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "count_error", err.Error())
		return
	}
	if count >= 3 {
		httpx.Error(w, http.StatusBadRequest, "too_many_options", "a product can have at most 3 options")
		return
	}

	var oid string
	err = tx.QueryRow(r.Context(),
		`INSERT INTO product_options (product_id, position, name) VALUES ($1, $2, $3) RETURNING id`,
		pid, count, req.Name,
	).Scan(&oid)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, http.StatusConflict, "option_exists", "an option with that name exists")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	for i, v := range dedupStrings(req.Values) {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO option_values (option_id, position, value) VALUES ($1, $2, $3)`,
			oid, i, v); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "value_insert", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	p, err := LoadByID(r.Context(), h.db, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, p)
}

func (h *Handler) DeleteOption(w http.ResponseWriter, r *http.Request) {
	oid := chi.URLParam(r, "optionId")
	res, err := h.db.Exec(r.Context(), `DELETE FROM product_options WHERE id = $1`, oid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "option not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type OptionValueReq struct {
	Value string `json:"value"`
}

func (h *Handler) AddOptionValue(w http.ResponseWriter, r *http.Request) {
	oid := chi.URLParam(r, "optionId")
	var req OptionValueReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Value = strings.TrimSpace(req.Value)
	if req.Value == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_value", "value required")
		return
	}
	var pos int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(position)+1, 0) FROM option_values WHERE option_id = $1`, oid,
	).Scan(&pos); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pos_error", err.Error())
		return
	}
	var id string
	err := h.db.QueryRow(r.Context(),
		`INSERT INTO option_values (option_id, position, value) VALUES ($1, $2, $3) RETURNING id`,
		oid, pos, req.Value,
	).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, http.StatusConflict, "value_exists", "value already exists on this option")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, OptionValue{ID: id, Position: pos, Value: req.Value})
}

func (h *Handler) DeleteOptionValue(w http.ResponseWriter, r *http.Request) {
	vid := chi.URLParam(r, "valueId")
	res, err := h.db.Exec(r.Context(), `DELETE FROM option_values WHERE id = $1`, vid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "value not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Variants ────────────────────────────────────────────────────────────

type VariantReq struct {
	SKU                string            `json:"sku"`
	Barcode            string            `json:"barcode"`
	PriceCents         int               `json:"priceCents"`
	CompareAtCents     *int              `json:"compareAtCents,omitempty"`
	CostCents          *int              `json:"costCents,omitempty"`
	WeightGrams        int               `json:"weightGrams"`
	TrackInventory     *bool             `json:"trackInventory,omitempty"`
	ContinueSellingOOS *bool             `json:"continueSellingOos,omitempty"`
	OptionValues       map[string]string `json:"optionValues"` // optionId -> valueId
}

func (h *Handler) AddVariant(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req VariantReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// Validate option values belong to this product's options, and combination is unique.
	optIDs, err := productOptionIDs(r.Context(), tx, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "options_error", err.Error())
		return
	}
	for _, oid := range optIDs {
		if _, ok := req.OptionValues[oid]; !ok {
			httpx.Error(w, http.StatusBadRequest, "missing_option", "must provide a value for every option on the product")
			return
		}
	}
	for oid, vid := range req.OptionValues {
		var ok bool
		if err := tx.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM option_values WHERE id = $1 AND option_id = $2)`,
			vid, oid,
		).Scan(&ok); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "validate_error", err.Error())
			return
		}
		if !ok {
			httpx.Error(w, http.StatusBadRequest, "invalid_option_value", "option value does not belong to the option")
			return
		}
	}
	// Duplicate variant check
	if len(optIDs) > 0 {
		if dup, err := findVariantByValues(r.Context(), tx, pid, req.OptionValues, ""); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "dup_check", err.Error())
			return
		} else if dup {
			httpx.Error(w, http.StatusConflict, "duplicate_variant", "a variant with this combination already exists")
			return
		}
	}

	var pos int
	if err := tx.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(position)+1, 0) FROM variants WHERE product_id = $1`, pid,
	).Scan(&pos); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pos_error", err.Error())
		return
	}

	track := true
	if req.TrackInventory != nil {
		track = *req.TrackInventory
	}
	cont := false
	if req.ContinueSellingOOS != nil {
		cont = *req.ContinueSellingOOS
	}

	var vid string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO variants (product_id, sku, barcode, price_cents, compare_at_cents,
                              cost_cents, weight_grams, position, track_inventory, continue_selling_oos)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
    `, pid, req.SKU, req.Barcode, req.PriceCents, req.CompareAtCents,
		req.CostCents, req.WeightGrams, pos, track, cont).Scan(&vid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	for oid, valID := range req.OptionValues {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO variant_option_values (variant_id, option_id, value_id) VALUES ($1, $2, $3)`,
			vid, oid, valID); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "vov_insert", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	p, err := LoadByID(r.Context(), h.db, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, p)
}

func (h *Handler) UpdateVariant(w http.ResponseWriter, r *http.Request) {
	vid := chi.URLParam(r, "variantId")
	var req VariantReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	sets := []string{"updated_at = now()"}
	args := []any{vid}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+itoa(len(args)))
	}
	add("sku", req.SKU)
	add("barcode", req.Barcode)
	add("price_cents", req.PriceCents)
	add("compare_at_cents", req.CompareAtCents)
	add("cost_cents", req.CostCents)
	add("weight_grams", req.WeightGrams)
	if req.TrackInventory != nil {
		add("track_inventory", *req.TrackInventory)
	}
	if req.ContinueSellingOOS != nil {
		add("continue_selling_oos", *req.ContinueSellingOOS)
	}
	_, err := h.db.Exec(r.Context(),
		"UPDATE variants SET "+strings.Join(sets, ", ")+" WHERE id = $1", args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}

	// If option values provided, replace them (keeping uniqueness check).
	if len(req.OptionValues) > 0 {
		var pid string
		if err := h.db.QueryRow(r.Context(), `SELECT product_id FROM variants WHERE id = $1`, vid).Scan(&pid); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				httpx.Error(w, http.StatusNotFound, "not_found", "variant not found")
				return
			}
			httpx.Error(w, http.StatusInternalServerError, "lookup_error", err.Error())
			return
		}
		if dup, err := findVariantByValues(r.Context(), h.db, pid, req.OptionValues, vid); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "dup_check", err.Error())
			return
		} else if dup {
			httpx.Error(w, http.StatusConflict, "duplicate_variant", "a variant with this combination already exists")
			return
		}
		tx, err := h.db.Begin(r.Context())
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
			return
		}
		defer tx.Rollback(r.Context())
		if _, err := tx.Exec(r.Context(),
			`DELETE FROM variant_option_values WHERE variant_id = $1`, vid); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "vov_clear", err.Error())
			return
		}
		for oid, val := range req.OptionValues {
			if _, err := tx.Exec(r.Context(),
				`INSERT INTO variant_option_values (variant_id, option_id, value_id) VALUES ($1, $2, $3)`,
				vid, oid, val); err != nil {
				httpx.Error(w, http.StatusInternalServerError, "vov_insert", err.Error())
				return
			}
		}
		if err := tx.Commit(r.Context()); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
			return
		}
	}

	var pid string
	if err := h.db.QueryRow(r.Context(), `SELECT product_id FROM variants WHERE id = $1`, vid).Scan(&pid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lookup_error", err.Error())
		return
	}
	p, err := LoadByID(r.Context(), h.db, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

func (h *Handler) DeleteVariant(w http.ResponseWriter, r *http.Request) {
	vid := chi.URLParam(r, "variantId")
	// Prevent deleting the last variant (product must always have at least 1).
	var pid string
	if err := h.db.QueryRow(r.Context(), `SELECT product_id FROM variants WHERE id = $1`, vid).Scan(&pid); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "variant not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "lookup_error", err.Error())
		return
	}
	var count int
	if err := h.db.QueryRow(r.Context(), `SELECT COUNT(*) FROM variants WHERE product_id = $1`, pid).Scan(&count); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "count_error", err.Error())
		return
	}
	if count <= 1 {
		httpx.Error(w, http.StatusBadRequest, "last_variant", "cannot delete the last variant of a product")
		return
	}
	if _, err := h.db.Exec(r.Context(), `DELETE FROM variants WHERE id = $1`, vid); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── helpers (pkg-private) ───────────────────────────────────────────────

// querier is satisfied by both *pgxpool.Pool and pgx.Tx so helpers work in either context.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func productOptionIDs(ctx context.Context, q querier, pid string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id FROM product_options WHERE product_id = $1 ORDER BY position`, pid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, nil
}

// findVariantByValues returns true if a variant with exactly the given (option,value) set exists for the product.
// excludeID is skipped (used when updating).
func findVariantByValues(ctx context.Context, q querier, pid string, values map[string]string, excludeID string) (bool, error) {
	if len(values) == 0 {
		return false, nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM variants WHERE product_id = $1`, pid)
	if err != nil {
		return false, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return false, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, vid := range ids {
		if excludeID != "" && vid == excludeID {
			continue
		}
		existing := map[string]string{}
		rs, err := q.Query(ctx, `SELECT option_id, value_id FROM variant_option_values WHERE variant_id = $1`, vid)
		if err != nil {
			return false, err
		}
		for rs.Next() {
			var o, v string
			if err := rs.Scan(&o, &v); err != nil {
				rs.Close()
				return false, err
			}
			existing[o] = v
		}
		rs.Close()
		if mapsEqual(existing, values) {
			return true, nil
		}
	}
	return false, nil
}

func mapsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func dedupTags(in []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, t := range in {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}

func dedupStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t == "" {
			continue
		}
		if _, ok := seen[t]; ok {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	return out
}
