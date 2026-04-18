package product

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("product not found")

type ListParams struct {
	Search      string
	Status      string
	Tag         string
	Vendor      string
	ProductType string
	Limit       int
	Cursor      string // base64-encoded "updated_at|id"
}

// LoadByID returns a product with all nested relations (options, variants, media, tags).
func LoadByID(ctx context.Context, db *pgxpool.Pool, id string) (*Product, error) {
	p := &Product{}
	err := db.QueryRow(ctx, `
        SELECT id, handle, title, description_html, status, vendor, product_type, tax_status,
               weight_grams, hs_code, seo_title, seo_description,
               published_at, created_at, updated_at
        FROM products WHERE id = $1
    `, id).Scan(
		&p.ID, &p.Handle, &p.Title, &p.DescriptionHTML, &p.Status,
		&p.Vendor, &p.ProductType, &p.TaxStatus,
		&p.WeightGrams, &p.HSCode, &p.SEOTitle, &p.SEODescription,
		&p.PublishedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := loadRelations(ctx, db, p); err != nil {
		return nil, err
	}
	return p, nil
}

// LoadByHandle is like LoadByID but looks up by handle.
func LoadByHandle(ctx context.Context, db *pgxpool.Pool, handle string) (*Product, error) {
	var id string
	err := db.QueryRow(ctx, `SELECT id FROM products WHERE handle = $1`, handle).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return LoadByID(ctx, db, id)
}

func loadRelations(ctx context.Context, db *pgxpool.Pool, p *Product) error {
	// Tags
	rows, err := db.Query(ctx, `SELECT tag FROM product_tags WHERE product_id = $1 ORDER BY tag`, p.ID)
	if err != nil {
		return err
	}
	p.Tags = []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			rows.Close()
			return err
		}
		p.Tags = append(p.Tags, t)
	}
	rows.Close()

	// Options
	rows, err = db.Query(ctx, `
        SELECT id, position, name FROM product_options
        WHERE product_id = $1 ORDER BY position, name
    `, p.ID)
	if err != nil {
		return err
	}
	p.Options = []Option{}
	for rows.Next() {
		var o Option
		if err := rows.Scan(&o.ID, &o.Position, &o.Name); err != nil {
			rows.Close()
			return err
		}
		o.Values = []OptionValue{}
		p.Options = append(p.Options, o)
	}
	rows.Close()

	// Option values
	for i := range p.Options {
		vrows, err := db.Query(ctx, `
            SELECT id, position, value FROM option_values
            WHERE option_id = $1 ORDER BY position, value
        `, p.Options[i].ID)
		if err != nil {
			return err
		}
		for vrows.Next() {
			var v OptionValue
			if err := vrows.Scan(&v.ID, &v.Position, &v.Value); err != nil {
				vrows.Close()
				return err
			}
			p.Options[i].Values = append(p.Options[i].Values, v)
		}
		vrows.Close()
	}

	// Variants
	rows, err = db.Query(ctx, `
        SELECT id, sku, barcode, price_cents, compare_at_cents, cost_cents,
               weight_grams, position, track_inventory, continue_selling_oos
        FROM variants WHERE product_id = $1 ORDER BY position, created_at
    `, p.ID)
	if err != nil {
		return err
	}
	p.Variants = []Variant{}
	for rows.Next() {
		v := Variant{ProductID: p.ID, OptionValues: map[string]string{}}
		if err := rows.Scan(&v.ID, &v.SKU, &v.Barcode, &v.PriceCents,
			&v.CompareAtCents, &v.CostCents, &v.WeightGrams, &v.Position,
			&v.TrackInventory, &v.ContinueSellingOOS); err != nil {
			rows.Close()
			return err
		}
		p.Variants = append(p.Variants, v)
	}
	rows.Close()

	// Variant option values
	for i := range p.Variants {
		vrows, err := db.Query(ctx, `
            SELECT option_id, value_id FROM variant_option_values WHERE variant_id = $1
        `, p.Variants[i].ID)
		if err != nil {
			return err
		}
		for vrows.Next() {
			var oid, vid string
			if err := vrows.Scan(&oid, &vid); err != nil {
				vrows.Close()
				return err
			}
			p.Variants[i].OptionValues[oid] = vid
		}
		vrows.Close()
	}

	// Media
	rows, err = db.Query(ctx, `
        SELECT id, variant_id, kind, object_key, url, alt, width, height, bytes, mime, position
        FROM product_media WHERE product_id = $1 ORDER BY position, created_at
    `, p.ID)
	if err != nil {
		return err
	}
	p.Media = []Media{}
	for rows.Next() {
		m := Media{ProductID: p.ID}
		if err := rows.Scan(&m.ID, &m.VariantID, &m.Kind, &m.ObjectKey,
			&m.URL, &m.Alt, &m.Width, &m.Height, &m.Bytes, &m.Mime, &m.Position); err != nil {
			rows.Close()
			return err
		}
		p.Media = append(p.Media, m)
	}
	rows.Close()

	return nil
}

// List returns a lightweight page of products for admin tables.
// Cursor pagination is by (updated_at DESC, id DESC).
func List(ctx context.Context, db *pgxpool.Pool, p ListParams) (*ListPage, error) {
	if p.Limit <= 0 || p.Limit > 100 {
		p.Limit = 20
	}

	args := []any{p.Limit + 1}
	where := []string{"TRUE"}
	addArg := func(a any) int {
		args = append(args, a)
		return len(args)
	}
	if p.Search != "" {
		i := addArg("%" + p.Search + "%")
		where = append(where, "(title ILIKE $"+itoa(i)+" OR handle ILIKE $"+itoa(i)+" OR vendor ILIKE $"+itoa(i)+")")
	}
	if p.Status != "" {
		i := addArg(p.Status)
		where = append(where, "status = $"+itoa(i))
	}
	if p.Vendor != "" {
		i := addArg(p.Vendor)
		where = append(where, "vendor = $"+itoa(i))
	}
	if p.ProductType != "" {
		i := addArg(p.ProductType)
		where = append(where, "product_type = $"+itoa(i))
	}
	if p.Tag != "" {
		i := addArg(p.Tag)
		where = append(where, "EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = p.id AND pt.tag = $"+itoa(i)+")")
	}
	if p.Cursor != "" {
		ts, id, ok := decodeCursor(p.Cursor)
		if ok {
			i1 := addArg(ts)
			i2 := addArg(id)
			where = append(where, "(updated_at, id) < ($"+itoa(i1)+", $"+itoa(i2)+")")
		}
	}

	q := `
        SELECT p.id, p.handle, p.title, p.status, p.vendor, p.product_type, p.updated_at,
               COALESCE((SELECT COUNT(*) FROM variants v WHERE v.product_id = p.id), 0) AS vc,
               COALESCE((SELECT MIN(v.price_cents) FROM variants v WHERE v.product_id = p.id), 0) AS minp,
               COALESCE((SELECT MAX(v.price_cents) FROM variants v WHERE v.product_id = p.id), 0) AS maxp,
               COALESCE((SELECT url FROM product_media m WHERE m.product_id = p.id ORDER BY position LIMIT 1), '') AS img
        FROM products p
        WHERE ` + joinWhere(where) + `
        ORDER BY updated_at DESC, id DESC
        LIMIT $1
    `
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ListPage{Items: []ListItem{}}
	var last ListItem
	n := 0
	for rows.Next() {
		var it ListItem
		if err := rows.Scan(&it.ID, &it.Handle, &it.Title, &it.Status, &it.Vendor, &it.ProductType,
			&it.UpdatedAt, &it.VariantCount, &it.MinPriceCents, &it.MaxPriceCents, &it.PrimaryImageURL); err != nil {
			return nil, err
		}
		n++
		if n <= p.Limit {
			out.Items = append(out.Items, it)
			last = it
		}
	}
	if n > p.Limit {
		out.NextCursor = encodeCursor(last.UpdatedAt, last.ID)
	}
	return out, nil
}

// minimal helpers
func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	d := []byte{}
	for n > 0 {
		d = append([]byte{byte('0' + n%10)}, d...)
		n /= 10
	}
	return string(d)
}

func joinWhere(ws []string) string {
	out := ws[0]
	for _, w := range ws[1:] {
		out += " AND " + w
	}
	return out
}

func encodeCursor(t time.Time, id string) string {
	return t.Format(time.RFC3339Nano) + "|" + id
}
func decodeCursor(s string) (time.Time, string, bool) {
	i := -1
	for k := len(s) - 1; k >= 0; k-- {
		if s[k] == '|' {
			i = k
			break
		}
	}
	if i < 0 {
		return time.Time{}, "", false
	}
	t, err := time.Parse(time.RFC3339Nano, s[:i])
	if err != nil {
		return time.Time{}, "", false
	}
	return t, s[i+1:], true
}
