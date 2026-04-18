package collection

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrNotFound = errors.New("collection not found")

// LoadByID returns a collection with its rules attached.
func LoadByID(ctx context.Context, db *pgxpool.Pool, id string) (*Collection, error) {
	c := &Collection{}
	err := db.QueryRow(ctx, `
        SELECT id, handle, title, description_html, image_url, is_rules_based, match_all,
               sort_order, seo_title, seo_description, published_at, created_at, updated_at
        FROM collections WHERE id = $1
    `, id).Scan(
		&c.ID, &c.Handle, &c.Title, &c.DescriptionHTML, &c.ImageURL, &c.IsRulesBased, &c.MatchAll,
		&c.SortOrder, &c.SEOTitle, &c.SEODescription, &c.PublishedAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.Rules = []Rule{}
	if c.IsRulesBased {
		rows, err := db.Query(ctx, `
            SELECT id, field, operator, value, position
            FROM collection_rules WHERE collection_id = $1
            ORDER BY position, id
        `, id)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var r Rule
			if err := rows.Scan(&r.ID, &r.Field, &r.Operator, &r.Value, &r.Position); err != nil {
				return nil, err
			}
			c.Rules = append(c.Rules, r)
		}
	}
	return c, nil
}

func LoadByHandle(ctx context.Context, db *pgxpool.Pool, handle string) (*Collection, error) {
	var id string
	err := db.QueryRow(ctx, `SELECT id FROM collections WHERE handle = $1`, handle).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return LoadByID(ctx, db, id)
}

// ListParams filters the admin collections list.
type ListParams struct {
	Search string
	Limit  int
	Cursor string
}

// List returns a paginated list of collections (lightweight).
func List(ctx context.Context, db *pgxpool.Pool, p ListParams) (*ListPage, error) {
	if p.Limit <= 0 || p.Limit > 100 {
		p.Limit = 20
	}
	args := []any{p.Limit + 1}
	where := []string{"TRUE"}
	addArg := func(v any) int { args = append(args, v); return len(args) }
	if p.Search != "" {
		i := addArg("%" + p.Search + "%")
		n := strconv.Itoa(i)
		where = append(where, "(c.title ILIKE $"+n+" OR c.handle ILIKE $"+n+")")
	}
	q := `
        SELECT c.id, c.handle, c.title, c.is_rules_based, c.image_url, c.updated_at,
               CASE
                   WHEN c.is_rules_based THEN 0
                   ELSE (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id)
               END AS pc
        FROM collections c
        WHERE ` + strings.Join(where, " AND ") + `
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT $1
    `
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &ListPage{Items: []ListItem{}}
	for rows.Next() {
		var it ListItem
		if err := rows.Scan(&it.ID, &it.Handle, &it.Title, &it.IsRulesBased, &it.ImageURL, &it.UpdatedAt, &it.ProductCount); err != nil {
			return nil, err
		}
		out.Items = append(out.Items, it)
	}
	return out, nil
}

// ListProducts returns the products belonging to a collection.
// For manual collections: rows from collection_products, ordered by position.
// For rules-based: evaluates rules against products and returns matches.
// activeOnly=true restricts to status='active' (used on storefront).
func ListProducts(ctx context.Context, db *pgxpool.Pool, c *Collection, activeOnly bool, limit int) ([]ProductRef, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	baseSelect := `
        SELECT p.id, p.handle, p.title, p.status,
               COALESCE((SELECT MIN(price_cents) FROM variants WHERE product_id = p.id), 0) AS minp,
               COALESCE((SELECT MAX(price_cents) FROM variants WHERE product_id = p.id), 0) AS maxp,
               COALESCE((SELECT url FROM product_media WHERE product_id = p.id ORDER BY position LIMIT 1), '') AS img
    `

	if !c.IsRulesBased {
		q := baseSelect + `, cp.position AS pos
            FROM collection_products cp
            JOIN products p ON p.id = cp.product_id
            WHERE cp.collection_id = $1 ` +
			statusFilter(activeOnly) + `
            ORDER BY cp.position, p.id
            LIMIT $2
        `
		rows, err := db.Query(ctx, q, c.ID, limit)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanProductRefs(rows)
	}

	// Rules-based: build WHERE from rules.
	expr, args, err := buildRuleSQL(c.Rules, c.MatchAll, 1)
	if err != nil {
		return nil, err
	}
	if expr == "" {
		return []ProductRef{}, nil
	}
	args = append(args, limit)
	limitPlaceholder := "$" + strconv.Itoa(len(args))

	q := baseSelect + `, 0 AS pos
            FROM products p
            WHERE (` + expr + `)` +
		statusFilter(activeOnly) + `
            ORDER BY ` + sortSQL(c.SortOrder) + `
            LIMIT ` + limitPlaceholder + `
        `
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("rule query: %w", err)
	}
	defer rows.Close()
	return scanProductRefs(rows)
}

func scanProductRefs(rows pgx.Rows) ([]ProductRef, error) {
	out := []ProductRef{}
	for rows.Next() {
		var r ProductRef
		if err := rows.Scan(&r.ID, &r.Handle, &r.Title, &r.Status,
			&r.MinPriceCents, &r.MaxPriceCents, &r.PrimaryImageURL, &r.Position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func statusFilter(activeOnly bool) string {
	if activeOnly {
		return " AND p.status = 'active'"
	}
	return ""
}

// sortSQL returns an ORDER BY clause for storefront/admin listing of rule-based collections.
func sortSQL(sortOrder string) string {
	switch sortOrder {
	case "price_asc":
		return "(SELECT MIN(price_cents) FROM variants v WHERE v.product_id = p.id) ASC NULLS LAST, p.id"
	case "price_desc":
		return "(SELECT MIN(price_cents) FROM variants v WHERE v.product_id = p.id) DESC NULLS LAST, p.id"
	case "alpha_asc":
		return "p.title ASC, p.id"
	case "alpha_desc":
		return "p.title DESC, p.id"
	case "created_desc":
		return "p.created_at DESC, p.id"
	case "best_selling":
		// Stub until we have order data (Phase 3).
		return "p.created_at DESC, p.id"
	}
	return "p.created_at DESC, p.id"
}
