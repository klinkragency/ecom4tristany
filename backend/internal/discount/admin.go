package discount

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

type DiscountDTO struct {
	ID                       string     `json:"id"`
	Code                     *string    `json:"code,omitempty"`
	Title                    string     `json:"title"`
	Kind                     string     `json:"kind"`
	ValuePercent             *float64   `json:"valuePercent,omitempty"`
	ValueCents               *int       `json:"valueCents,omitempty"`
	Scope                    string     `json:"scope"`
	Eligibility              string     `json:"eligibility"`
	UsageLimit               *int       `json:"usageLimit,omitempty"`
	UsageLimitPerCustomer    *int       `json:"usageLimitPerCustomer,omitempty"`
	MinSubtotalCents         int        `json:"minSubtotalCents"`
	UsageCount               int        `json:"usageCount"`
	BOGOBuyQuantity          *int       `json:"bogoBuyQuantity,omitempty"`
	BOGOGetQuantity          *int       `json:"bogoGetQuantity,omitempty"`
	BOGOGetDiscountPercent   *float64   `json:"bogoGetDiscountPercent,omitempty"`
	BOGOBuyScope             *string    `json:"bogoBuyScope,omitempty"`
	BOGOGetScope             *string    `json:"bogoGetScope,omitempty"`
	Active                   bool       `json:"active"`
	StartsAt                 *time.Time `json:"startsAt,omitempty"`
	EndsAt                   *time.Time `json:"endsAt,omitempty"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
	// Joined targets. Empty when scope='all'.
	ProductIDs    []string `json:"productIds"`
	CollectionIDs []string `json:"collectionIds"`
	BuyProductIDs    []string `json:"buyProductIds,omitempty"`
	BuyCollectionIDs []string `json:"buyCollectionIds,omitempty"`
	GetProductIDs    []string `json:"getProductIds,omitempty"`
	GetCollectionIDs []string `json:"getCollectionIds,omitempty"`
	SegmentIDs       []string `json:"segmentIds"`
}

type DiscountInput struct {
	Code                   string     `json:"code"`
	Title                  string     `json:"title"`
	Kind                   string     `json:"kind"`
	ValuePercent           *float64   `json:"valuePercent"`
	ValueCents             *int       `json:"valueCents"`
	Scope                  string     `json:"scope"`
	Eligibility            string     `json:"eligibility"`
	UsageLimit             *int       `json:"usageLimit"`
	UsageLimitPerCustomer  *int       `json:"usageLimitPerCustomer"`
	MinSubtotalCents       int        `json:"minSubtotalCents"`
	BOGOBuyQuantity        *int       `json:"bogoBuyQuantity"`
	BOGOGetQuantity        *int       `json:"bogoGetQuantity"`
	BOGOGetDiscountPercent *float64   `json:"bogoGetDiscountPercent"`
	BOGOBuyScope           *string    `json:"bogoBuyScope"`
	BOGOGetScope           *string    `json:"bogoGetScope"`
	Active                 bool       `json:"active"`
	StartsAt               *time.Time `json:"startsAt"`
	EndsAt                 *time.Time `json:"endsAt"`
	ProductIDs       []string `json:"productIds"`
	CollectionIDs    []string `json:"collectionIds"`
	BuyProductIDs    []string `json:"buyProductIds"`
	BuyCollectionIDs []string `json:"buyCollectionIds"`
	GetProductIDs    []string `json:"getProductIds"`
	GetCollectionIDs []string `json:"getCollectionIds"`
	SegmentIDs       []string `json:"segmentIds"`
}

// ─── CRUD handlers ──────────────────────────────────────────────────────

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), listDiscountSQL()+` ORDER BY created_at DESC LIMIT 200`)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []DiscountDTO{}
	for rows.Next() {
		d, err := scanDiscount(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, *d)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	d, err := loadDiscount(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "discount not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var req DiscountInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	var codeArg any
	if req.Code == "" {
		codeArg = nil
	} else {
		codeArg = req.Code
	}
	err = tx.QueryRow(r.Context(), `
        INSERT INTO discounts (
          code, title, kind, value_percent, value_cents, scope, eligibility,
          usage_limit, usage_limit_per_customer, min_subtotal_cents,
          bogo_buy_quantity, bogo_get_quantity, bogo_get_discount_percent,
          bogo_buy_scope, bogo_get_scope,
          active, starts_at, ends_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10,
          $11, $12, $13,
          $14, $15,
          $16, $17, $18
        ) RETURNING id
    `, codeArg, req.Title, req.Kind, req.ValuePercent, req.ValueCents,
		req.Scope, req.Eligibility,
		req.UsageLimit, req.UsageLimitPerCustomer, req.MinSubtotalCents,
		req.BOGOBuyQuantity, req.BOGOGetQuantity, req.BOGOGetDiscountPercent,
		req.BOGOBuyScope, req.BOGOGetScope,
		req.Active, req.StartsAt, req.EndsAt,
	).Scan(&id)
	if err != nil {
		httpx.Error(w, codeOrConflict(err), "insert_error", err.Error())
		return
	}
	if err := writeTargets(r.Context(), tx, id, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "targets_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	d, _ := loadDiscount(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusCreated, d)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req DiscountInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var codeArg any
	if req.Code == "" {
		codeArg = nil
	} else {
		codeArg = req.Code
	}
	res, err := tx.Exec(r.Context(), `
        UPDATE discounts SET
          code = $1, title = $2, kind = $3,
          value_percent = $4, value_cents = $5,
          scope = $6, eligibility = $7,
          usage_limit = $8, usage_limit_per_customer = $9, min_subtotal_cents = $10,
          bogo_buy_quantity = $11, bogo_get_quantity = $12, bogo_get_discount_percent = $13,
          bogo_buy_scope = $14, bogo_get_scope = $15,
          active = $16, starts_at = $17, ends_at = $18,
          updated_at = now()
        WHERE id = $19
    `, codeArg, req.Title, req.Kind, req.ValuePercent, req.ValueCents,
		req.Scope, req.Eligibility,
		req.UsageLimit, req.UsageLimitPerCustomer, req.MinSubtotalCents,
		req.BOGOBuyQuantity, req.BOGOGetQuantity, req.BOGOGetDiscountPercent,
		req.BOGOBuyScope, req.BOGOGetScope,
		req.Active, req.StartsAt, req.EndsAt,
		id,
	)
	if err != nil {
		httpx.Error(w, codeOrConflict(err), "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "discount not found")
		return
	}
	// Replace all target rows.
	if _, err := tx.Exec(r.Context(), `DELETE FROM discount_products    WHERE discount_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_p", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM discount_collections WHERE discount_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_c", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM discount_segments    WHERE discount_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_s", err.Error())
		return
	}
	if err := writeTargets(r.Context(), tx, id, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "targets_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	d, _ := loadDiscount(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM discounts WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "discount not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func validateInput(r *DiscountInput) error {
	r.Title = strings.TrimSpace(r.Title)
	r.Code = strings.TrimSpace(r.Code)
	if r.Title == "" {
		return errors.New("title required")
	}
	switch r.Kind {
	case "percentage":
		if r.ValuePercent == nil || *r.ValuePercent <= 0 || *r.ValuePercent > 100 {
			return errors.New("valuePercent must be between 0 and 100")
		}
	case "amount":
		if r.ValueCents == nil || *r.ValueCents <= 0 {
			return errors.New("valueCents must be > 0")
		}
	case "free_shipping":
		// nothing extra
	case "bogo":
		if r.BOGOBuyQuantity == nil || *r.BOGOBuyQuantity <= 0 {
			return errors.New("bogoBuyQuantity must be > 0")
		}
		if r.BOGOGetQuantity == nil || *r.BOGOGetQuantity <= 0 {
			return errors.New("bogoGetQuantity must be > 0")
		}
		if r.BOGOGetDiscountPercent == nil || *r.BOGOGetDiscountPercent <= 0 || *r.BOGOGetDiscountPercent > 100 {
			return errors.New("bogoGetDiscountPercent must be between 0 and 100")
		}
		if r.BOGOBuyScope == nil || (*r.BOGOBuyScope != "products" && *r.BOGOBuyScope != "collections") {
			return errors.New("bogoBuyScope must be 'products' or 'collections'")
		}
		if r.BOGOGetScope == nil || (*r.BOGOGetScope != "products" && *r.BOGOGetScope != "collections") {
			return errors.New("bogoGetScope must be 'products' or 'collections'")
		}
	default:
		return errors.New("kind must be one of percentage|amount|free_shipping|bogo")
	}
	switch r.Scope {
	case "all", "products", "collections":
	default:
		return errors.New("scope must be all|products|collections")
	}
	switch r.Eligibility {
	case "all", "segments":
	default:
		return errors.New("eligibility must be all|segments")
	}
	return nil
}

// writeTargets inserts the product/collection/segment join rows for a
// discount. `list` is 'apply' for the non-BOGO targets, plus 'buy'/'get'
// for BOGO.
func writeTargets(ctx context.Context, tx pgx.Tx, discountID string, req *DiscountInput) error {
	writeList := func(list string, productIDs, collectionIDs []string) error {
		for _, p := range productIDs {
			if _, err := tx.Exec(ctx,
				`INSERT INTO discount_products (discount_id, product_id, list) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				discountID, p, list,
			); err != nil {
				return err
			}
		}
		for _, c := range collectionIDs {
			if _, err := tx.Exec(ctx,
				`INSERT INTO discount_collections (discount_id, collection_id, list) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
				discountID, c, list,
			); err != nil {
				return err
			}
		}
		return nil
	}
	if err := writeList("apply", req.ProductIDs, req.CollectionIDs); err != nil {
		return err
	}
	if err := writeList("buy", req.BuyProductIDs, req.BuyCollectionIDs); err != nil {
		return err
	}
	if err := writeList("get", req.GetProductIDs, req.GetCollectionIDs); err != nil {
		return err
	}
	for _, s := range req.SegmentIDs {
		if _, err := tx.Exec(ctx,
			`INSERT INTO discount_segments (discount_id, segment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			discountID, s,
		); err != nil {
			return err
		}
	}
	return nil
}

func listDiscountSQL() string {
	return `SELECT id, code, title, kind, value_percent, value_cents, scope,
               eligibility, usage_limit, usage_limit_per_customer,
               min_subtotal_cents, usage_count,
               bogo_buy_quantity, bogo_get_quantity, bogo_get_discount_percent,
               bogo_buy_scope, bogo_get_scope,
               active, starts_at, ends_at, created_at, updated_at
        FROM discounts`
}

func scanDiscount(row pgx.Row) (*DiscountDTO, error) {
	var d DiscountDTO
	err := row.Scan(
		&d.ID, &d.Code, &d.Title, &d.Kind, &d.ValuePercent, &d.ValueCents, &d.Scope,
		&d.Eligibility, &d.UsageLimit, &d.UsageLimitPerCustomer,
		&d.MinSubtotalCents, &d.UsageCount,
		&d.BOGOBuyQuantity, &d.BOGOGetQuantity, &d.BOGOGetDiscountPercent,
		&d.BOGOBuyScope, &d.BOGOGetScope,
		&d.Active, &d.StartsAt, &d.EndsAt, &d.CreatedAt, &d.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func loadDiscount(ctx context.Context, db *pgxpool.Pool, id string) (*DiscountDTO, error) {
	row := db.QueryRow(ctx, listDiscountSQL()+` WHERE id = $1`, id)
	d, err := scanDiscount(row)
	if err != nil {
		return nil, err
	}
	// Attach joined targets.
	prodByList, err := fetchProductsGrouped(ctx, db, id)
	if err != nil {
		return nil, err
	}
	collByList, err := fetchCollectionsGrouped(ctx, db, id)
	if err != nil {
		return nil, err
	}
	d.ProductIDs = prodByList["apply"]
	d.BuyProductIDs = prodByList["buy"]
	d.GetProductIDs = prodByList["get"]
	d.CollectionIDs = collByList["apply"]
	d.BuyCollectionIDs = collByList["buy"]
	d.GetCollectionIDs = collByList["get"]
	segments, err := fetchSegments(ctx, db, id)
	if err != nil {
		return nil, err
	}
	d.SegmentIDs = segments
	if d.ProductIDs == nil {
		d.ProductIDs = []string{}
	}
	if d.CollectionIDs == nil {
		d.CollectionIDs = []string{}
	}
	if d.SegmentIDs == nil {
		d.SegmentIDs = []string{}
	}
	return d, nil
}

func fetchProductsGrouped(ctx context.Context, db *pgxpool.Pool, id string) (map[string][]string, error) {
	rows, err := db.Query(ctx,
		`SELECT product_id, list FROM discount_products WHERE discount_id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var p, list string
		if err := rows.Scan(&p, &list); err != nil {
			return nil, err
		}
		out[list] = append(out[list], p)
	}
	return out, nil
}

func fetchCollectionsGrouped(ctx context.Context, db *pgxpool.Pool, id string) (map[string][]string, error) {
	rows, err := db.Query(ctx,
		`SELECT collection_id, list FROM discount_collections WHERE discount_id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var c, list string
		if err := rows.Scan(&c, &list); err != nil {
			return nil, err
		}
		out[list] = append(out[list], c)
	}
	return out, nil
}

func fetchSegments(ctx context.Context, db *pgxpool.Pool, id string) ([]string, error) {
	rows, err := db.Query(ctx, `SELECT segment_id FROM discount_segments WHERE discount_id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, nil
}

func codeOrConflict(err error) int {
	if err == nil {
		return http.StatusOK
	}
	if strings.Contains(err.Error(), "duplicate key") {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}
