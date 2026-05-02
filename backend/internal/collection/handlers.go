package collection

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/3mg/shop/backend/internal/htmlx"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── List / Get ──────────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	page, err := List(r.Context(), h.db, ListParams{
		Search: q.Get("q"),
		Limit:  limit,
		Cursor: q.Get("cursor"),
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "list_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, page)
}

type getResp struct {
	*Collection
	Products []ProductRef `json:"products"`
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	c, err := LoadByID(r.Context(), h.db, chi.URLParam(r, "id"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "collection not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	products, err := ListProducts(r.Context(), h.db, c, false, 500)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "list_products_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, getResp{Collection: c, Products: products})
}

// ─── Create / Update / Delete ────────────────────────────────────────────

type CreateReq struct {
	Title           string `json:"title"`
	Handle          string `json:"handle"`
	DescriptionHTML string `json:"descriptionHtml"`
	ImageURL        string `json:"imageUrl"`
	IsRulesBased    bool   `json:"isRulesBased"`
	MatchAll        *bool  `json:"matchAll,omitempty"`
	SortOrder       string `json:"sortOrder"`
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	if req.Title == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_title", "title required")
		return
	}
	if req.SortOrder == "" {
		req.SortOrder = "manual"
	}
	if !validSortOrders[req.SortOrder] {
		httpx.Error(w, http.StatusBadRequest, "invalid_sort", "invalid sortOrder")
		return
	}
	if req.IsRulesBased && req.SortOrder == "manual" {
		// manual ordering makes no sense for rule-based collections
		req.SortOrder = "created_desc"
	}
	matchAll := true
	if req.MatchAll != nil {
		matchAll = *req.MatchAll
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

	var id string
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO collections (handle, title, description_html, image_url, is_rules_based, match_all, sort_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
    `, handle, req.Title, htmlx.Sanitize(req.DescriptionHTML), req.ImageURL, req.IsRulesBased, matchAll, req.SortOrder).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	c, err := LoadByID(r.Context(), h.db, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, c)
}

type UpdateReq struct {
	Title           *string `json:"title,omitempty"`
	Handle          *string `json:"handle,omitempty"`
	DescriptionHTML *string `json:"descriptionHtml,omitempty"`
	ImageURL        *string `json:"imageUrl,omitempty"`
	MatchAll        *bool   `json:"matchAll,omitempty"`
	SortOrder       *string `json:"sortOrder,omitempty"`
	SEOTitle        *string `json:"seoTitle,omitempty"`
	SEODescription  *string `json:"seoDescription,omitempty"`
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req UpdateReq
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
	if req.Title != nil {
		add("title", *req.Title)
	}
	if req.DescriptionHTML != nil {
		add("description_html", htmlx.Sanitize(*req.DescriptionHTML))
	}
	if req.ImageURL != nil {
		add("image_url", *req.ImageURL)
	}
	if req.MatchAll != nil {
		add("match_all", *req.MatchAll)
	}
	if req.SortOrder != nil {
		if !validSortOrders[*req.SortOrder] {
			httpx.Error(w, http.StatusBadRequest, "invalid_sort", "invalid sortOrder")
			return
		}
		add("sort_order", *req.SortOrder)
	}
	if req.SEOTitle != nil {
		add("seo_title", *req.SEOTitle)
	}
	if req.SEODescription != nil {
		add("seo_description", *req.SEODescription)
	}
	if req.Handle != nil {
		nh, err := uniqueHandle(r.Context(), h.db, *req.Handle, id)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "handle_error", err.Error())
			return
		}
		add("handle", nh)
	}

	if len(sets) > 1 {
		_, err := h.db.Exec(r.Context(),
			"UPDATE collections SET "+strings.Join(sets, ", ")+" WHERE id = $1",
			args...)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
			return
		}
	}
	c, err := LoadByID(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "collection not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, c)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM collections WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "collection not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Products on manual collections ──────────────────────────────────────

type AttachReq struct {
	ProductIDs []string `json:"productIds"`
}

func (h *Handler) AttachProducts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req AttachReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	// Ensure collection is manual.
	var isRules bool
	err := h.db.QueryRow(r.Context(), `SELECT is_rules_based FROM collections WHERE id = $1`, id).Scan(&isRules)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "collection not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if isRules {
		httpx.Error(w, http.StatusBadRequest, "rule_based", "cannot manually attach products to a rule-based collection")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var nextPos int
	if err := tx.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(position)+1, 0) FROM collection_products WHERE collection_id = $1`, id,
	).Scan(&nextPos); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pos_error", err.Error())
		return
	}
	for _, pid := range req.ProductIDs {
		_, err := tx.Exec(r.Context(),
			`INSERT INTO collection_products (collection_id, product_id, position)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
			id, pid, nextPos)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23503" {
				httpx.Error(w, http.StatusBadRequest, "fk", fmt.Sprintf("unknown product %q", pid))
				return
			}
			httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
			return
		}
		nextPos++
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DetachProduct(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	pid := chi.URLParam(r, "productId")
	_, err := h.db.Exec(r.Context(),
		`DELETE FROM collection_products WHERE collection_id = $1 AND product_id = $2`,
		id, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ReorderReq struct {
	OrderedProductIDs []string `json:"orderedProductIds"`
}

func (h *Handler) ReorderProducts(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req ReorderReq
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
	for i, pid := range req.OrderedProductIDs {
		if _, err := tx.Exec(r.Context(),
			`UPDATE collection_products SET position = $1 WHERE collection_id = $2 AND product_id = $3`,
			i, id, pid); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "reorder_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Rules (rule-based collections) ──────────────────────────────────────

type RuleReq struct {
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
}

func (h *Handler) AddRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req RuleReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if !validFields[req.Field] {
		httpx.Error(w, http.StatusBadRequest, "invalid_field", "invalid field")
		return
	}
	if !validOperators[req.Operator] {
		httpx.Error(w, http.StatusBadRequest, "invalid_operator", "invalid operator")
		return
	}
	// Ensure collection is rule-based.
	var isRules bool
	err := h.db.QueryRow(r.Context(), `SELECT is_rules_based FROM collections WHERE id = $1`, id).Scan(&isRules)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "collection not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if !isRules {
		httpx.Error(w, http.StatusBadRequest, "not_rule_based", "this collection is manual, not rule-based")
		return
	}
	var pos int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(position)+1, 0) FROM collection_rules WHERE collection_id = $1`, id,
	).Scan(&pos); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pos_error", err.Error())
		return
	}
	var rid string
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO collection_rules (collection_id, field, operator, value, position)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
    `, id, req.Field, req.Operator, req.Value, pos).Scan(&rid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, Rule{
		ID: rid, Field: req.Field, Operator: req.Operator, Value: req.Value, Position: pos,
	})
}

func (h *Handler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	rid := chi.URLParam(r, "ruleId")
	res, err := h.db.Exec(r.Context(), `DELETE FROM collection_rules WHERE id = $1`, rid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "rule not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Live preview for smart collections ─────────────────────────────────
//
// POST /api/admin/collections/preview returns the products that currently
// match the given rule set without persisting anything. Powers the smart
// collection form's live preview while the user is editing rules.

type PreviewReq struct {
	Rules     []RuleReq `json:"rules"`
	MatchAll  bool      `json:"matchAll"`
	SortOrder string    `json:"sortOrder"`
	Limit     int       `json:"limit,omitempty"`
}

type PreviewResp struct {
	Items []ProductRef `json:"items"`
}

func (h *Handler) Preview(w http.ResponseWriter, r *http.Request) {
	var req PreviewReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	limit := req.Limit
	if limit <= 0 || limit > 100 {
		limit = 24
	}
	sortOrder := req.SortOrder
	if !validSortOrders[sortOrder] || sortOrder == "manual" {
		sortOrder = "created_desc"
	}
	// Translate the wire-level RuleReq into the shared Rule shape used by
	// the SQL builder. We only need the rule fields (no IDs/positions).
	rules := make([]Rule, 0, len(req.Rules))
	for _, rr := range req.Rules {
		if !validFields[rr.Field] {
			httpx.Error(w, http.StatusBadRequest, "invalid_field", "invalid field "+rr.Field)
			return
		}
		if !validOperators[rr.Operator] {
			httpx.Error(w, http.StatusBadRequest, "invalid_operator", "invalid operator "+rr.Operator)
			return
		}
		rules = append(rules, Rule{Field: rr.Field, Operator: rr.Operator, Value: rr.Value})
	}

	// Reuse ListProducts via a synthetic Collection so that all rule-matching
	// SQL stays in one place.
	c := &Collection{
		IsRulesBased: true,
		MatchAll:     req.MatchAll,
		SortOrder:    sortOrder,
		Rules:        rules,
	}
	items, err := ListProducts(r.Context(), h.db, c, false, limit)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "preview_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, PreviewResp{Items: items})
}

// ─── Handle helpers ──────────────────────────────────────────────────────

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlug.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "collection"
	}
	return s
}

func uniqueHandle(ctx context.Context, db *pgxpool.Pool, base, excludeID string) (string, error) {
	base = slugify(base)
	for i := 0; i < 50; i++ {
		cand := base
		if i > 0 {
			cand = fmt.Sprintf("%s-%d", base, i+1)
		}
		var exists bool
		err := db.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM collections WHERE handle = $1 AND ($2 = '' OR id <> $2::uuid))`,
			cand, excludeID,
		).Scan(&exists)
		if err != nil {
			return "", err
		}
		if !exists {
			return cand, nil
		}
	}
	return "", fmt.Errorf("could not generate unique handle from %q", base)
}
