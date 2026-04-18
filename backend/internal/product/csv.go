package product

import (
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/htmlx"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── HTTP handlers ───────────────────────────────────────────────────────

// ExportCSV streams a products CSV file to the client as a download.
func (h *Handler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	filename := fmt.Sprintf("products-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if err := ExportAllCSV(r.Context(), h.db, w); err != nil {
		// Too late for a JSON error — log implicitly via truncated download.
		fmt.Fprintf(w, "\n# error: %s\n", err.Error())
	}
}

// ImportCSVHandler accepts either a raw text/csv body or a multipart upload
// with a `file` field and returns a JSON summary of what was created/updated
// plus row-level errors.
func (h *Handler) ImportCSVHandler(w http.ResponseWriter, r *http.Request) {
	var reader io.Reader

	ct := r.Header.Get("Content-Type")
	switch {
	case strings.HasPrefix(ct, "multipart/form-data"):
		if err := r.ParseMultipartForm(32 << 20); err != nil { // 32 MiB cap
			httpx.Error(w, http.StatusBadRequest, "invalid_form", err.Error())
			return
		}
		f, _, err := r.FormFile("file")
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "missing_file", `expected a "file" field`)
			return
		}
		defer f.Close()
		reader = f
	case strings.HasPrefix(ct, "text/csv"), strings.HasPrefix(ct, "text/plain"):
		reader = r.Body
		defer r.Body.Close()
	default:
		httpx.Error(w, http.StatusUnsupportedMediaType, "bad_content_type",
			"send the CSV as multipart/form-data (field 'file') or text/csv body")
		return
	}

	result, err := ImportCSV(r.Context(), h.db, reader)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "import_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

// CSV column layout (Shopify-compatible subset). One row per variant; for a
// product with N variants, the product-level fields repeat on every row. The
// first variant row carries the product-level fields on export; subsequent
// rows leave them blank (Shopify convention). On import, blanks inherit from
// the previous non-blank row sharing the same Handle.
var csvHeader = []string{
	"Handle",
	"Title",
	"Body HTML",
	"Vendor",
	"Type",
	"Tags",
	"Status",
	"Option1 Name", "Option1 Value",
	"Option2 Name", "Option2 Value",
	"Option3 Name", "Option3 Value",
	"Variant SKU",
	"Variant Barcode",
	"Variant Price",
	"Variant Compare At Price",
	"Variant Weight Grams",
	"SEO Title",
	"SEO Description",
}

// ─── Export ──────────────────────────────────────────────────────────────

// ExportAllCSV streams every product (and all of their variants) to `w`.
func ExportAllCSV(ctx context.Context, db *pgxpool.Pool, w io.Writer) error {
	cw := csv.NewWriter(w)
	defer cw.Flush()

	if err := cw.Write(csvHeader); err != nil {
		return err
	}

	rows, err := db.Query(ctx, `SELECT id FROM products ORDER BY created_at DESC`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()

	for _, id := range ids {
		p, err := LoadByID(ctx, db, id)
		if err != nil {
			return err
		}
		if err := writeProductCSV(cw, p); err != nil {
			return err
		}
	}
	return nil
}

func writeProductCSV(cw *csv.Writer, p *Product) error {
	optName := func(i int) string {
		if i < len(p.Options) {
			return p.Options[i].Name
		}
		return ""
	}
	variantValue := func(v Variant, i int) string {
		if i >= len(p.Options) {
			return ""
		}
		o := p.Options[i]
		valID := v.OptionValues[o.ID]
		for _, ov := range o.Values {
			if ov.ID == valID {
				return ov.Value
			}
		}
		return ""
	}

	variants := p.Variants
	if len(variants) == 0 {
		variants = []Variant{{}}
	}

	for i, v := range variants {
		row := make([]string, len(csvHeader))
		if i == 0 {
			row[0] = p.Handle
			row[1] = p.Title
			row[2] = p.DescriptionHTML
			row[3] = p.Vendor
			row[4] = p.ProductType
			row[5] = strings.Join(p.Tags, ", ")
			row[6] = p.Status
			row[18] = p.SEOTitle
			row[19] = p.SEODescription
		} else {
			row[0] = p.Handle // repeat handle so rows are self-linkable
		}
		row[7] = optName(0)
		row[8] = variantValue(v, 0)
		row[9] = optName(1)
		row[10] = variantValue(v, 1)
		row[11] = optName(2)
		row[12] = variantValue(v, 2)
		row[13] = v.SKU
		row[14] = v.Barcode
		row[15] = priceStr(v.PriceCents)
		if v.CompareAtCents != nil {
			row[16] = priceStr(*v.CompareAtCents)
		}
		row[17] = strconv.Itoa(v.WeightGrams)
		if err := cw.Write(row); err != nil {
			return err
		}
	}
	return nil
}

func priceStr(cents int) string {
	return strconv.FormatFloat(float64(cents)/100.0, 'f', 2, 64)
}

// ─── Import ──────────────────────────────────────────────────────────────

type ImportResult struct {
	Rows            int             `json:"rows"`
	ProductsCreated int             `json:"productsCreated"`
	ProductsUpdated int             `json:"productsUpdated"`
	VariantsCreated int             `json:"variantsCreated"`
	VariantsUpdated int             `json:"variantsUpdated"`
	Errors          []ImportError   `json:"errors"`
}

type ImportError struct {
	Row     int    `json:"row"`
	Handle  string `json:"handle,omitempty"`
	Message string `json:"message"`
}

// ImportCSV parses a Shopify-style products CSV and upserts products + variants
// by Handle. It does NOT touch media. Processing is transactional per product.
func ImportCSV(ctx context.Context, db *pgxpool.Pool, r io.Reader) (*ImportResult, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1 // tolerate trailing empty columns

	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}
	idx := headerIndex(header)
	if _, ok := idx["handle"]; !ok {
		return nil, errors.New("CSV is missing the 'Handle' column")
	}

	result := &ImportResult{Errors: []ImportError{}}

	// First pass: group rows by handle so we can process a whole product at once.
	groups := map[string][]importRow{}
	order := []string{}
	rowN := 1 // header was row 1
	for {
		row, err := cr.Read()
		if err == io.EOF {
			break
		}
		rowN++
		if err != nil {
			result.Errors = append(result.Errors, ImportError{Row: rowN, Message: err.Error()})
			continue
		}
		handle := strings.TrimSpace(field(row, idx, "handle"))
		if handle == "" {
			result.Errors = append(result.Errors, ImportError{Row: rowN, Message: "missing Handle"})
			continue
		}
		if _, seen := groups[handle]; !seen {
			order = append(order, handle)
		}
		groups[handle] = append(groups[handle], importRow{n: rowN, data: row})
		result.Rows++
	}

	for _, handle := range order {
		rows := groups[handle]
		if err := importOneProduct(ctx, db, handle, rows, idx, result); err != nil {
			result.Errors = append(result.Errors, ImportError{Handle: handle, Row: rows[0].n, Message: err.Error()})
		}
	}
	return result, nil
}

type importRow struct {
	n    int
	data []string
}

func importOneProduct(
	ctx context.Context,
	db *pgxpool.Pool,
	handle string,
	rows []importRow,
	idx map[string]int,
	result *ImportResult,
) error {
	// Flatten product-level fields: take first non-empty value across rows.
	pick := func(col string) string {
		for _, r := range rows {
			if v := strings.TrimSpace(field(r.data, idx, col)); v != "" {
				return v
			}
		}
		return ""
	}
	title := pick("title")
	if title == "" {
		return errors.New("missing Title")
	}
	status := strings.ToLower(pick("status"))
	if status == "" {
		status = "draft"
	}
	if status != "draft" && status != "active" && status != "archived" {
		return fmt.Errorf("invalid Status %q", status)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Upsert product.
	var pid string
	row := tx.QueryRow(ctx, `SELECT id FROM products WHERE handle = $1`, handle)
	err = row.Scan(&pid)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
            INSERT INTO products (handle, title, description_html, status, vendor, product_type,
                                  seo_title, seo_description)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `, handle, title, htmlx.Sanitize(pick("body html")), status,
			pick("vendor"), pick("type"),
			pick("seo title"), pick("seo description"),
		).Scan(&pid)
		if err != nil {
			return err
		}
		result.ProductsCreated++
	} else if err != nil {
		return err
	} else {
		_, err = tx.Exec(ctx, `
            UPDATE products SET
              title = $2, description_html = $3, status = $4, vendor = $5,
              product_type = $6, seo_title = $7, seo_description = $8,
              updated_at = now()
            WHERE id = $1
        `, pid, title, htmlx.Sanitize(pick("body html")), status,
			pick("vendor"), pick("type"),
			pick("seo title"), pick("seo description"),
		)
		if err != nil {
			return err
		}
		result.ProductsUpdated++
	}

	// Tags: replace set.
	tagsRaw := pick("tags")
	if _, err := tx.Exec(ctx, `DELETE FROM product_tags WHERE product_id = $1`, pid); err != nil {
		return err
	}
	for _, t := range splitTags(tagsRaw) {
		if _, err := tx.Exec(ctx,
			`INSERT INTO product_tags (product_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			pid, t); err != nil {
			return err
		}
	}

	// Gather option definitions from all rows.
	optDefs := []struct {
		name   string
		values []string
	}{{}, {}, {}}
	for _, r := range rows {
		for i := 0; i < 3; i++ {
			n := strings.TrimSpace(field(r.data, idx, fmt.Sprintf("option%d name", i+1)))
			v := strings.TrimSpace(field(r.data, idx, fmt.Sprintf("option%d value", i+1)))
			if n != "" && optDefs[i].name == "" {
				optDefs[i].name = n
			}
			if v != "" && !contains(optDefs[i].values, v) {
				optDefs[i].values = append(optDefs[i].values, v)
			}
		}
	}

	// Ensure options + option values exist. Build a map optionName→{id, values: map[val]valueId}.
	type optInfo struct {
		id     string
		values map[string]string
	}
	opts := make([]*optInfo, 3)
	for i, def := range optDefs {
		if def.name == "" {
			continue
		}
		info := &optInfo{values: map[string]string{}}
		// Find or create the option.
		err := tx.QueryRow(ctx,
			`SELECT id FROM product_options WHERE product_id = $1 AND name = $2`,
			pid, def.name,
		).Scan(&info.id)
		if errors.Is(err, pgx.ErrNoRows) {
			err = tx.QueryRow(ctx, `
                INSERT INTO product_options (product_id, position, name) VALUES ($1, $2, $3)
                RETURNING id
            `, pid, i, def.name).Scan(&info.id)
			if err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		// Existing values.
		vrows, err := tx.Query(ctx,
			`SELECT id, value FROM option_values WHERE option_id = $1`, info.id)
		if err != nil {
			return err
		}
		for vrows.Next() {
			var id, v string
			if err := vrows.Scan(&id, &v); err != nil {
				vrows.Close()
				return err
			}
			info.values[v] = id
		}
		vrows.Close()
		// Add missing values.
		for pos, v := range def.values {
			if _, ok := info.values[v]; ok {
				continue
			}
			var vid string
			err := tx.QueryRow(ctx, `
                INSERT INTO option_values (option_id, position, value) VALUES ($1, $2, $3)
                RETURNING id
            `, info.id, pos, v).Scan(&vid)
			if err != nil {
				return err
			}
			info.values[v] = vid
		}
		opts[i] = info
	}

	// Per-row: upsert variant.
	for _, r := range rows {
		sku := strings.TrimSpace(field(r.data, idx, "variant sku"))
		priceStr := strings.TrimSpace(field(r.data, idx, "variant price"))
		var priceCents int
		if priceStr != "" {
			if f, err := strconv.ParseFloat(priceStr, 64); err == nil {
				priceCents = int(f * 100)
			}
		}
		var compareAt *int
		if c := strings.TrimSpace(field(r.data, idx, "variant compare at price")); c != "" {
			if f, err := strconv.ParseFloat(c, 64); err == nil {
				v := int(f * 100)
				compareAt = &v
			}
		}
		weight := 0
		if wg := strings.TrimSpace(field(r.data, idx, "variant weight grams")); wg != "" {
			weight, _ = strconv.Atoi(wg)
		}
		barcode := strings.TrimSpace(field(r.data, idx, "variant barcode"))

		// Resolve option values for this variant.
		rowOptionValues := map[string]string{}
		for i := 0; i < 3; i++ {
			info := opts[i]
			if info == nil {
				continue
			}
			raw := strings.TrimSpace(field(r.data, idx, fmt.Sprintf("option%d value", i+1)))
			if raw == "" {
				continue
			}
			if vid, ok := info.values[raw]; ok {
				rowOptionValues[info.id] = vid
			}
		}

		// Look for an existing variant with this (product, optionValues).
		existingID, err := findVariantIDByValues(ctx, tx, pid, rowOptionValues)
		if err != nil {
			return err
		}
		if existingID != "" {
			_, err = tx.Exec(ctx, `
                UPDATE variants SET sku = $2, barcode = $3, price_cents = $4,
                  compare_at_cents = $5, weight_grams = $6, updated_at = now()
                WHERE id = $1
            `, existingID, sku, barcode, priceCents, compareAt, weight)
			if err != nil {
				return err
			}
			result.VariantsUpdated++
		} else {
			var pos int
			if err := tx.QueryRow(ctx,
				`SELECT COALESCE(MAX(position)+1, 0) FROM variants WHERE product_id = $1`, pid,
			).Scan(&pos); err != nil {
				return err
			}
			var vid string
			err = tx.QueryRow(ctx, `
                INSERT INTO variants (product_id, sku, barcode, price_cents, compare_at_cents,
                                      weight_grams, position)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, pid, sku, barcode, priceCents, compareAt, weight, pos).Scan(&vid)
			if err != nil {
				return err
			}
			for oid, valID := range rowOptionValues {
				if _, err := tx.Exec(ctx,
					`INSERT INTO variant_option_values (variant_id, option_id, value_id) VALUES ($1, $2, $3)`,
					vid, oid, valID); err != nil {
					return err
				}
			}
			result.VariantsCreated++
		}
	}

	return tx.Commit(ctx)
}

// findVariantIDByValues returns the id of a variant on product pid whose
// (option_id → value_id) map exactly matches `want`, or "" if none.
func findVariantIDByValues(ctx context.Context, q querier, pid string, want map[string]string) (string, error) {
	if len(want) == 0 {
		// Product has no options — one default variant.
		rows, err := q.Query(ctx, `SELECT id FROM variants WHERE product_id = $1 LIMIT 1`, pid)
		if err != nil {
			return "", err
		}
		defer rows.Close()
		if rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return "", err
			}
			return id, nil
		}
		return "", nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM variants WHERE product_id = $1`, pid)
	if err != nil {
		return "", err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, vid := range ids {
		got := map[string]string{}
		rs, err := q.Query(ctx,
			`SELECT option_id, value_id FROM variant_option_values WHERE variant_id = $1`, vid)
		if err != nil {
			return "", err
		}
		for rs.Next() {
			var o, v string
			if err := rs.Scan(&o, &v); err != nil {
				rs.Close()
				return "", err
			}
			got[o] = v
		}
		rs.Close()
		if mapsEqual(got, want) {
			return vid, nil
		}
	}
	return "", nil
}

// ─── small helpers ───────────────────────────────────────────────────────

func headerIndex(h []string) map[string]int {
	m := make(map[string]int, len(h))
	for i, k := range h {
		m[strings.ToLower(strings.TrimSpace(k))] = i
	}
	return m
}

func field(row []string, idx map[string]int, name string) string {
	i, ok := idx[name]
	if !ok || i >= len(row) {
		return ""
	}
	return row[i]
}

func splitTags(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		t := strings.ToLower(strings.TrimSpace(p))
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

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
