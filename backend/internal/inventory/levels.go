package inventory

import (
	"net/http"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
)

// ─── Product inventory matrix ────────────────────────────────────────────

// ProductMatrix returns all variants for a product alongside per-location
// levels, in a shape that's easy to render as a table.
func (h *Handler) ProductMatrix(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")

	// Verify product exists.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM products WHERE id = $1)`, pid,
	).Scan(&exists); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if !exists {
		httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}

	m := ProductMatrix{ProductID: pid, Locations: []MatrixLoc{}, Variants: []MatrixVariant{}}

	// Locations (all, including inactive — admin can see them).
	lrows, err := h.db.Query(r.Context(),
		`SELECT id, name, is_active FROM locations ORDER BY created_at`)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	for lrows.Next() {
		var l MatrixLoc
		if err := lrows.Scan(&l.ID, &l.Name, &l.Active); err != nil {
			lrows.Close()
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		m.Locations = append(m.Locations, l)
	}
	lrows.Close()

	// Variants + per-variant label via joined option values.
	vrows, err := h.db.Query(r.Context(), `
        SELECT v.id, v.sku, v.track_inventory,
               COALESCE(
                   (SELECT string_agg(ov.value, ' / ' ORDER BY po.position)
                    FROM variant_option_values vov
                    JOIN option_values ov ON ov.id = vov.value_id
                    JOIN product_options po ON po.id = vov.option_id
                    WHERE vov.variant_id = v.id),
                   'Default'
               ) AS label
        FROM variants v
        WHERE v.product_id = $1
        ORDER BY v.position, v.created_at
    `, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	for vrows.Next() {
		var v MatrixVariant
		v.Levels = map[string]Cell{}
		if err := vrows.Scan(&v.ID, &v.SKU, &v.Track, &v.Label); err != nil {
			vrows.Close()
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		m.Variants = append(m.Variants, v)
	}
	vrows.Close()

	// Pre-populate every variant × location cell with zeros so the UI gets a
	// complete matrix even where no inventory_levels row exists yet.
	for i := range m.Variants {
		for _, l := range m.Locations {
			m.Variants[i].Levels[l.ID] = Cell{}
		}
	}

	// Fill in actual levels.
	rows, err := h.db.Query(r.Context(), `
        SELECT il.variant_id, il.location_id, il.on_hand, il.committed, il.incoming
        FROM inventory_levels il
        JOIN variants v ON v.id = il.variant_id
        WHERE v.product_id = $1
    `, pid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	for rows.Next() {
		var vid, lid string
		var c Cell
		if err := rows.Scan(&vid, &lid, &c.OnHand, &c.Committed, &c.Incoming); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		for i := range m.Variants {
			if m.Variants[i].ID == vid {
				m.Variants[i].Levels[lid] = c
				m.Variants[i].TotalOnHand += c.OnHand
				break
			}
		}
	}
	httpx.JSON(w, http.StatusOK, m)
}

// ─── Bulk set inventory levels ───────────────────────────────────────────

type SetLevelsReq struct {
	Levels []struct {
		VariantID  string `json:"variantId"`
		LocationID string `json:"locationId"`
		OnHand     int    `json:"onHand"`
	} `json:"levels"`
	Reason string `json:"reason"` // for the audit trail; defaults to 'correction'
	Note   string `json:"note"`
}

// SetLevels replaces on_hand for the given (variant, location) pairs and
// records adjustments for the delta so inventory history stays auditable.
func (h *Handler) SetLevels(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var req SetLevelsReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	reason := req.Reason
	if reason == "" {
		reason = "correction"
	}
	if !ValidReasons[reason] {
		httpx.Error(w, http.StatusBadRequest, "invalid_reason", "invalid reason code")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	for _, lv := range req.Levels {
		if lv.OnHand < 0 {
			httpx.Error(w, http.StatusBadRequest, "negative_stock", "on_hand cannot be negative")
			return
		}
		// Determine previous value for delta.
		var prev int
		err := tx.QueryRow(r.Context(),
			`SELECT on_hand FROM inventory_levels WHERE variant_id = $1 AND location_id = $2`,
			lv.VariantID, lv.LocationID,
		).Scan(&prev)
		if err != nil && err.Error() != "no rows in result set" {
			// pgx.ErrNoRows case handled by err comparison below.
		}
		// Upsert.
		_, err = tx.Exec(r.Context(), `
            INSERT INTO inventory_levels (variant_id, location_id, on_hand, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (variant_id, location_id)
            DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = now()
        `, lv.VariantID, lv.LocationID, lv.OnHand)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "upsert_error", err.Error())
			return
		}
		if delta := lv.OnHand - prev; delta != 0 {
			_, err = tx.Exec(r.Context(), `
                INSERT INTO inventory_adjustments (variant_id, location_id, delta, reason, note, admin_id)
                VALUES ($1, $2, $3, $4, $5, $6)
            `, lv.VariantID, lv.LocationID, delta, reason, req.Note, sess.UserID)
			if err != nil {
				httpx.Error(w, http.StatusInternalServerError, "adjust_error", err.Error())
				return
			}
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Single-row adjustment ───────────────────────────────────────────────

type AdjustReq struct {
	VariantID  string `json:"variantId"`
	LocationID string `json:"locationId"`
	Delta      int    `json:"delta"`
	Reason     string `json:"reason"`
	Note       string `json:"note"`
}

// Adjust nudges on_hand by `delta` and records the adjustment. Useful for
// "received 10 units", "damaged 2 units" etc.
func (h *Handler) Adjust(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var req AdjustReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if !ValidReasons[req.Reason] {
		httpx.Error(w, http.StatusBadRequest, "invalid_reason", "invalid reason code")
		return
	}
	if req.Delta == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	_, err = tx.Exec(r.Context(), `
        INSERT INTO inventory_levels (variant_id, location_id, on_hand, updated_at)
        VALUES ($1, $2, GREATEST($3, 0), now())
        ON CONFLICT (variant_id, location_id)
        DO UPDATE SET on_hand = GREATEST(inventory_levels.on_hand + $3, 0), updated_at = now()
    `, req.VariantID, req.LocationID, req.Delta)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "upsert_error", err.Error())
		return
	}
	_, err = tx.Exec(r.Context(), `
        INSERT INTO inventory_adjustments (variant_id, location_id, delta, reason, note, admin_id)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, req.VariantID, req.LocationID, req.Delta, req.Reason, req.Note, sess.UserID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "adjust_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
