package inventory

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ─── Transfers state machine ─────────────────────────────────────────────
//
//   draft → ship → in_transit → receive → received
//   draft → cancel → cancelled
//
// Inventory effect:
//   - ship:    source.on_hand -= qty, destination.incoming += qty
//   - receive: destination.incoming -= qty, destination.on_hand += qty
//   - cancel:  no inventory effect (only draft is cancellable).

func (h *Handler) ListTransfers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT t.id, t.from_location, t.to_location,
               f.name AS from_name, tt.name AS to_name,
               t.status, t.note, t.created_by, t.created_at, t.shipped_at, t.received_at,
               COALESCE((SELECT SUM(quantity) FROM stock_transfer_items WHERE transfer_id = t.id), 0) AS total
        FROM stock_transfers t
        JOIN locations f  ON f.id  = t.from_location
        JOIN locations tt ON tt.id = t.to_location
        ORDER BY t.created_at DESC
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Transfer{}
	for rows.Next() {
		var t Transfer
		if err := rows.Scan(&t.ID, &t.FromLocationID, &t.ToLocationID,
			&t.FromName, &t.ToName, &t.Status, &t.Note, &t.CreatedByID,
			&t.CreatedAt, &t.ShippedAt, &t.ReceivedAt, &t.TotalUnits); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, t)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) GetTransfer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, err := h.loadTransfer(r, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "transfer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, t)
}

type CreateTransferReq struct {
	FromLocationID string `json:"fromLocationId"`
	ToLocationID   string `json:"toLocationId"`
	Note           string `json:"note"`
	Items          []struct {
		VariantID string `json:"variantId"`
		Quantity  int    `json:"quantity"`
	} `json:"items"`
}

func (h *Handler) CreateTransfer(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var req CreateTransferReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.FromLocationID == req.ToLocationID {
		httpx.Error(w, http.StatusBadRequest, "same_location", "from and to must differ")
		return
	}
	if len(req.Items) == 0 {
		httpx.Error(w, http.StatusBadRequest, "empty", "at least one item required")
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
        INSERT INTO stock_transfers (from_location, to_location, status, note, created_by)
        VALUES ($1, $2, 'draft', $3, $4)
        RETURNING id
    `, req.FromLocationID, req.ToLocationID, req.Note, sess.UserID).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	for _, it := range req.Items {
		if it.Quantity <= 0 {
			httpx.Error(w, http.StatusBadRequest, "bad_qty", "quantity must be > 0")
			return
		}
		_, err = tx.Exec(r.Context(), `
            INSERT INTO stock_transfer_items (transfer_id, variant_id, quantity)
            VALUES ($1, $2, $3)
        `, id, it.VariantID, it.Quantity)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "item_insert_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	t, err := h.loadTransfer(r, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, t)
}

func (h *Handler) ShipTransfer(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "draft", "in_transit", func(tx pgx.Tx, id string) error {
		// Pull items + from_location.
		var fromLoc string
		if err := tx.QueryRow(r.Context(),
			`SELECT from_location FROM stock_transfers WHERE id = $1`, id).Scan(&fromLoc); err != nil {
			return err
		}
		items, err := itemsOf(tx, r, id)
		if err != nil {
			return err
		}
		var destLoc string
		if err := tx.QueryRow(r.Context(),
			`SELECT to_location FROM stock_transfers WHERE id = $1`, id).Scan(&destLoc); err != nil {
			return err
		}
		for _, it := range items {
			// Source: decrement on_hand (must have enough).
			var onHand int
			err := tx.QueryRow(r.Context(),
				`SELECT on_hand FROM inventory_levels WHERE variant_id = $1 AND location_id = $2`,
				it.VariantID, fromLoc,
			).Scan(&onHand)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if onHand < it.Quantity {
				return fmt.Errorf("not enough stock at source for variant %s (have %d, need %d)", it.VariantID, onHand, it.Quantity)
			}
			if _, err := tx.Exec(r.Context(), `
                UPDATE inventory_levels SET on_hand = on_hand - $3, updated_at = now()
                WHERE variant_id = $1 AND location_id = $2
            `, it.VariantID, fromLoc, it.Quantity); err != nil {
				return err
			}
			// Destination: add to incoming (create row if missing).
			if _, err := tx.Exec(r.Context(), `
                INSERT INTO inventory_levels (variant_id, location_id, incoming, updated_at)
                VALUES ($1, $2, $3, now())
                ON CONFLICT (variant_id, location_id)
                DO UPDATE SET incoming = inventory_levels.incoming + $3, updated_at = now()
            `, it.VariantID, destLoc, it.Quantity); err != nil {
				return err
			}
		}
		_, err = tx.Exec(r.Context(),
			`UPDATE stock_transfers SET status = 'in_transit', shipped_at = now() WHERE id = $1`, id)
		return err
	})
}

func (h *Handler) ReceiveTransfer(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "in_transit", "received", func(tx pgx.Tx, id string) error {
		var destLoc string
		if err := tx.QueryRow(r.Context(),
			`SELECT to_location FROM stock_transfers WHERE id = $1`, id).Scan(&destLoc); err != nil {
			return err
		}
		items, err := itemsOf(tx, r, id)
		if err != nil {
			return err
		}
		for _, it := range items {
			if _, err := tx.Exec(r.Context(), `
                UPDATE inventory_levels
                SET incoming = GREATEST(incoming - $3, 0),
                    on_hand  = on_hand + $3,
                    updated_at = now()
                WHERE variant_id = $1 AND location_id = $2
            `, it.VariantID, destLoc, it.Quantity); err != nil {
				return err
			}
		}
		_, err = tx.Exec(r.Context(),
			`UPDATE stock_transfers SET status = 'received', received_at = now() WHERE id = $1`, id)
		return err
	})
}

func (h *Handler) CancelTransfer(w http.ResponseWriter, r *http.Request) {
	h.transition(w, r, "draft", "cancelled", func(tx pgx.Tx, id string) error {
		_, err := tx.Exec(r.Context(),
			`UPDATE stock_transfers SET status = 'cancelled' WHERE id = $1`, id)
		return err
	})
}

// transition wraps an atomic status change with a pre-check on the starting
// status and a custom mutation that applies the inventory side-effects.
func (h *Handler) transition(
	w http.ResponseWriter,
	r *http.Request,
	fromStatus, toStatus string,
	apply func(tx pgx.Tx, id string) error,
) {
	id := chi.URLParam(r, "id")

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var current string
	err = tx.QueryRow(r.Context(),
		`SELECT status FROM stock_transfers WHERE id = $1 FOR UPDATE`, id,
	).Scan(&current)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "transfer not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if current != fromStatus {
		httpx.Error(w, http.StatusConflict, "invalid_transition",
			fmt.Sprintf("transfer is %q, cannot transition to %q", current, toStatus))
		return
	}

	if err := apply(tx, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "apply_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	t, err := h.loadTransfer(r, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, t)
}

func itemsOf(tx pgx.Tx, r *http.Request, transferID string) ([]TransferItem, error) {
	rows, err := tx.Query(r.Context(),
		`SELECT variant_id, quantity FROM stock_transfer_items WHERE transfer_id = $1`, transferID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TransferItem
	for rows.Next() {
		var it TransferItem
		if err := rows.Scan(&it.VariantID, &it.Quantity); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

func (h *Handler) loadTransfer(r *http.Request, id string) (*Transfer, error) {
	t := &Transfer{}
	err := h.db.QueryRow(r.Context(), `
        SELECT t.id, t.from_location, t.to_location,
               f.name, tt.name,
               t.status, t.note, t.created_by, t.created_at, t.shipped_at, t.received_at
        FROM stock_transfers t
        JOIN locations f  ON f.id  = t.from_location
        JOIN locations tt ON tt.id = t.to_location
        WHERE t.id = $1
    `, id).Scan(&t.ID, &t.FromLocationID, &t.ToLocationID,
		&t.FromName, &t.ToName, &t.Status, &t.Note, &t.CreatedByID,
		&t.CreatedAt, &t.ShippedAt, &t.ReceivedAt)
	if err != nil {
		return nil, err
	}
	rows, err := h.db.Query(r.Context(), `
        SELECT sti.variant_id, v.sku,
               COALESCE(
                   (SELECT string_agg(ov.value, ' / ' ORDER BY po.position)
                    FROM variant_option_values vov
                    JOIN option_values ov ON ov.id = vov.value_id
                    JOIN product_options po ON po.id = vov.option_id
                    WHERE vov.variant_id = v.id),
                   'Default'
               ) AS label,
               sti.quantity
        FROM stock_transfer_items sti
        JOIN variants v ON v.id = sti.variant_id
        WHERE sti.transfer_id = $1
    `, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	t.Items = []TransferItem{}
	for rows.Next() {
		var it TransferItem
		if err := rows.Scan(&it.VariantID, &it.SKU, &it.Label, &it.Quantity); err != nil {
			return nil, err
		}
		t.Items = append(t.Items, it)
		t.TotalUnits += it.Quantity
	}
	return t, nil
}
