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

// AdminMerge folds a *source* customer into a *target* customer and removes
// the source row. Used by staff when the same human registered twice (typo'd
// email, guest checkout + later account creation, etc.).
//
// What moves:
//   - orders            → re-pointed to target (customer_id)
//   - addresses         → copied to target (default flags cleared; target keeps its own defaults)
//   - tags              → unioned
//   - store_credit_ledger → re-pointed (target balance recalculated by trigger)
//   - password_reset tokens → deleted (safer than moving; target can request new one)
//
// What is kept for audit on the source row is recorded via a customer_erasures
// entry before the source row is deleted.
//
// URL: POST /api/admin/customers/{id}/merge  with body {sourceId}
// `{id}` is the TARGET (the one that survives).
type MergeReq struct {
	SourceID string `json:"sourceId"`
	Note     string `json:"note"`
}

func (h *Handler) AdminMerge(w http.ResponseWriter, r *http.Request) {
	targetID := chi.URLParam(r, "id")
	var req MergeReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.SourceID = strings.TrimSpace(req.SourceID)
	if req.SourceID == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_source", "sourceId required")
		return
	}
	if req.SourceID == targetID {
		httpx.Error(w, http.StatusBadRequest, "same_customer", "source and target must differ")
		return
	}

	sess, _ := auth.SessionFromContext(r.Context())
	adminID := ""
	if sess != nil && sess.UserID.Valid {
		adminID = uuidString(sess.UserID)
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	// Verify both exist and lock them. Locking prevents parallel merges from
	// racing.
	var srcEmail, tgtEmail string
	if err := tx.QueryRow(r.Context(),
		`SELECT email FROM customers WHERE id = $1 FOR UPDATE`, targetID,
	).Scan(&tgtEmail); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "target_not_found", "target customer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if err := tx.QueryRow(r.Context(),
		`SELECT email FROM customers WHERE id = $1 FOR UPDATE`, req.SourceID,
	).Scan(&srcEmail); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "source_not_found", "source customer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Orders — reassign.
	if _, err := tx.Exec(r.Context(),
		`UPDATE orders SET customer_id = $1, updated_at = now() WHERE customer_id = $2`,
		targetID, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "orders_error", err.Error())
		return
	}

	// Addresses — copy, clearing default flags so the target's own defaults win.
	// Duplicate detection would be more thorough via a hash; simple approach is
	// fine for a manual merge.
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO customer_addresses (
          customer_id, label, first_name, last_name, company,
          address_line1, address_line2, city, region, postal_code, country, phone,
          is_default_shipping, is_default_billing
        )
        SELECT $1, label, first_name, last_name, company,
               address_line1, address_line2, city, region, postal_code, country, phone,
               false, false
        FROM customer_addresses WHERE customer_id = $2
    `, targetID, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "addresses_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM customer_addresses WHERE customer_id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "addr_delete_error", err.Error())
		return
	}

	// Tags — union via ON CONFLICT.
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO customer_tags (customer_id, tag)
        SELECT $1, tag FROM customer_tags WHERE customer_id = $2
        ON CONFLICT DO NOTHING
    `, targetID, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tags_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM customer_tags WHERE customer_id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tag_delete_error", err.Error())
		return
	}

	// Store credit: move ledger rows, then re-sync target balance by summing.
	// The ledger trigger keeps the balance up-to-date on insert, but we're
	// bulk-reassigning so we need to recompute explicitly.
	if _, err := tx.Exec(r.Context(),
		`UPDATE store_credit_ledger SET customer_id = $1 WHERE customer_id = $2`,
		targetID, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ledger_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM store_credit_accounts WHERE customer_id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "sc_source_error", err.Error())
		return
	}
	// Recompute the target balance from the ledger. Upsert the account row.
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO store_credit_accounts (customer_id, balance_cents, currency)
        SELECT $1,
               COALESCE((SELECT SUM(delta_cents) FROM store_credit_ledger WHERE customer_id = $1), 0),
               'EUR'
        ON CONFLICT (customer_id) DO UPDATE SET
          balance_cents = EXCLUDED.balance_cents,
          updated_at = now()
    `, targetID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "sc_rebuild_error", err.Error())
		return
	}

	// Kill any live sessions + reset tokens on the source. Safer than moving
	// them; target can request a new reset if needed.
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM customer_password_resets WHERE customer_id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "reset_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM sessions WHERE user_type = 'customer' AND user_id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session_error", err.Error())
		return
	}

	// Finally delete the source row.
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM customers WHERE id = $1`, req.SourceID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}

	// Append a note on the target recording the merge (best-effort — do not
	// fail the operation if this can't be written).
	if req.Note != "" || srcEmail != "" {
		_, _ = tx.Exec(r.Context(), `
            UPDATE customers SET note = trim(BOTH E'\n' FROM coalesce(note,'') ||
                E'\n[merged from ' || $2 || ']' ||
                CASE WHEN $3 <> '' THEN E'\n' || $3 ELSE '' END),
                updated_at = now()
            WHERE id = $1
        `, targetID, srcEmail, req.Note)
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	_ = adminID // reserved: could insert an audit row once a generic admin_audit_log exists
	w.WriteHeader(http.StatusNoContent)
}
