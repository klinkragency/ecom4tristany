package product

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// Slugify turns a title into a URL-safe handle.
func Slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = nonSlug.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return "product"
	}
	return s
}

// uniqueHandle returns a handle that doesn't collide with an existing product.
// excludeID is ignored in the uniqueness check (used when updating the same product).
func uniqueHandle(ctx context.Context, db *pgxpool.Pool, base string, excludeID string) (string, error) {
	base = Slugify(base)
	for i := 0; i < 50; i++ {
		cand := base
		if i > 0 {
			cand = fmt.Sprintf("%s-%d", base, i+1)
		}
		var exists bool
		err := db.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM products WHERE handle = $1 AND ($2 = '' OR id <> $2::uuid))`,
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
