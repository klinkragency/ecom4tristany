package inventory

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/3mg/shop/backend/internal/httpx"
)

// LowStockThreshold is the cutoff under which the dashboard flags a row as
// "low stock". Hardcoded here for Phase A — Phase B will let merchants set
// per-variant or shop-wide thresholds.
const LowStockThreshold = 5

// InventoryRow is the variant-summary view shown on /inventory: stock totals
// aggregated across every location, plus a count of locations the variant
// actually appears in.
type InventoryRow struct {
	VariantID     string  `json:"variantId"`
	ProductID     string  `json:"productId"`
	ProductTitle  string  `json:"productTitle"`
	VariantTitle  string  `json:"variantTitle"`
	SKU           string  `json:"sku"`
	ImageURL      string  `json:"imageUrl"`
	OnHand        int     `json:"onHand"`
	Committed     int     `json:"committed"`
	Available     int     `json:"available"`
	LocationCount int     `json:"locationCount"`
	Track         bool    `json:"track"`
	Low           bool    `json:"low"`
	Out           bool    `json:"out"`
}

// Dashboard returns one row per variant with totals across all locations,
// optionally filtered by status (all / low / out) and search (title or SKU).
//
// Untracked variants (track_inventory=false) are still listed but their
// numeric fields are zero and their `track` flag is false — the UI shows
// them as "Not tracked".
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	status := r.URL.Query().Get("status")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 50
	}

	args := []any{}
	whereParts := []string{}

	// Search (title / SKU / handle / variant_title) — case-insensitive
	// substring. Not blazing fast but fine for shops under a few thousand
	// SKUs; can move to a tsv later.
	if q != "" {
		args = append(args, "%"+q+"%")
		idx := strconv.Itoa(len(args))
		whereParts = append(whereParts,
			"(p.title ILIKE $"+idx+
				" OR v.sku ILIKE $"+idx+
				" OR p.handle ILIKE $"+idx+")")
	}

	// Status filter is applied post-aggregation via HAVING. The threshold
	// param is only added when it's actually referenced — otherwise Postgres
	// can't infer the type of an unused $N (SQLSTATE 42P18).
	having := ""
	switch status {
	case "low":
		args = append(args, LowStockThreshold)
		thIdx := strconv.Itoa(len(args))
		having = "HAVING (COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0)) > 0" +
			" AND (COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0)) <= $" + thIdx + "::int" +
			" AND v.track_inventory = true"
	case "out":
		having = "HAVING (COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0)) <= 0" +
			" AND v.track_inventory = true"
	}

	args = append(args, limit)
	limitIdx := strconv.Itoa(len(args))

	where := ""
	if len(whereParts) > 0 {
		where = "WHERE " + strings.Join(whereParts, " AND ")
	}

	sql := `
        SELECT v.id, p.id, p.title,
               COALESCE(
                   (SELECT string_agg(ov.value, ' / ' ORDER BY po.position)
                    FROM variant_option_values vov
                    JOIN option_values ov ON ov.id = vov.value_id
                    JOIN product_options po ON po.id = vov.option_id
                    WHERE vov.variant_id = v.id),
                   ''
               ) AS variant_title,
               v.sku,
               COALESCE(
                   (SELECT url FROM product_media WHERE product_id = p.id ORDER BY position LIMIT 1),
                   ''
               ) AS image_url,
               COALESCE(SUM(il.on_hand), 0) AS on_hand,
               COALESCE(SUM(il.committed), 0) AS committed,
               (COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0)) AS available,
               COUNT(il.location_id) FILTER (WHERE il.on_hand > 0 OR il.committed > 0) AS loc_count,
               v.track_inventory
        FROM variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN inventory_levels il ON il.variant_id = v.id
        ` + where + `
        GROUP BY v.id, p.id, p.title, v.sku, v.track_inventory
        ` + having + `
        ORDER BY v.track_inventory DESC,
                 (COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0)) ASC,
                 p.title
        LIMIT $` + limitIdx + `
    `

	rows, err := h.db.Query(r.Context(), sql, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	items := []InventoryRow{}
	for rows.Next() {
		var it InventoryRow
		if err := rows.Scan(
			&it.VariantID, &it.ProductID, &it.ProductTitle, &it.VariantTitle,
			&it.SKU, &it.ImageURL, &it.OnHand, &it.Committed, &it.Available,
			&it.LocationCount, &it.Track,
		); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		if it.Track {
			it.Out = it.Available <= 0
			it.Low = !it.Out && it.Available <= LowStockThreshold
		}
		items = append(items, it)
	}

	// Totals (across the unfiltered table) — useful for the header KPIs.
	// Explicit ::int cast on $1: pgx can't infer the type of a parameter
	// used solely as the right-hand side of a comparison in a FILTER clause.
	var totalSKUs, lowCount, outCount int
	_ = h.db.QueryRow(r.Context(), `
        SELECT
          COUNT(*) FILTER (WHERE v.track_inventory = true) AS sku_count,
          COUNT(*) FILTER (
            WHERE v.track_inventory = true
              AND (sub.available > 0 AND sub.available <= $1::int)
          ) AS low_count,
          COUNT(*) FILTER (
            WHERE v.track_inventory = true
              AND sub.available <= 0
          ) AS out_count
        FROM variants v
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(il.on_hand), 0) - COALESCE(SUM(il.committed), 0) AS available
          FROM inventory_levels il WHERE il.variant_id = v.id
        ) sub ON true
    `, LowStockThreshold).Scan(&totalSKUs, &lowCount, &outCount)

	httpx.JSON(w, http.StatusOK, map[string]any{
		"items":     items,
		"totalSkus": totalSKUs,
		"lowCount":  lowCount,
		"outCount":  outCount,
		"threshold": LowStockThreshold,
	})
}
