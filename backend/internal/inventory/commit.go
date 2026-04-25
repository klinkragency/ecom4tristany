package inventory

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ErrInsufficientStock is returned by CheckAvailability when at least one
// requested variant has fewer units available than the requested quantity.
// The message names the offending variant so the buyer can see which item
// went out of stock between cart and checkout.
var ErrInsufficientStock = errors.New("insufficient stock")

// LineRequest is one cart line as seen by the inventory layer.
type LineRequest struct {
	VariantID string
	Quantity  int
}

// available = sum(on_hand) - sum(committed) across every location for the
// given variant. We don't subtract `incoming` — that's stock on the way *in*,
// not yet sellable.
const availableQuery = `
    SELECT COALESCE(SUM(on_hand), 0) - COALESCE(SUM(committed), 0)
    FROM inventory_levels
    WHERE variant_id = $1
`

// CheckAvailability verifies every requested line has enough sellable stock.
// Variants with track_inventory=false are skipped (services, digital goods).
//
// MUST run inside the same transaction as the subsequent commit/INSERT so
// the read is consistent with the write.
func CheckAvailability(ctx context.Context, tx pgx.Tx, req []LineRequest) error {
	for _, line := range req {
		var track bool
		err := tx.QueryRow(ctx,
			`SELECT track_inventory FROM variants WHERE id = $1`, line.VariantID,
		).Scan(&track)
		if err != nil {
			return fmt.Errorf("load variant %s: %w", line.VariantID, err)
		}
		if !track {
			continue
		}

		var available int
		if err := tx.QueryRow(ctx, availableQuery, line.VariantID).Scan(&available); err != nil {
			return fmt.Errorf("check stock for %s: %w", line.VariantID, err)
		}
		if available < line.Quantity {
			return fmt.Errorf("%w: variant %s (need %d, have %d)",
				ErrInsufficientStock, line.VariantID, line.Quantity, available)
		}
	}
	return nil
}

// PrimaryFulfillmentLocation picks the location where committed stock should
// be reserved at order time. Strategy: first active+fulfillment location by
// creation order. Returns "" if no location qualifies — caller should treat
// that as "skip the commit, just trust on_hand".
func PrimaryFulfillmentLocation(ctx context.Context, tx pgx.Tx) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
        SELECT id FROM locations
        WHERE is_active = true AND is_fulfillment = true
        ORDER BY created_at
        LIMIT 1
    `).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return id, nil
}

// Commit bumps committed for a single (variant, location) line. Creates the
// inventory_levels row if it doesn't exist yet (a variant may not have a row
// at every location until its first stock event). No-op if locationID is
// empty or the variant doesn't track inventory.
func Commit(ctx context.Context, tx pgx.Tx, variantID, locationID string, qty int) error {
	if locationID == "" || qty <= 0 {
		return nil
	}
	var track bool
	if err := tx.QueryRow(ctx,
		`SELECT track_inventory FROM variants WHERE id = $1`, variantID,
	).Scan(&track); err != nil {
		return err
	}
	if !track {
		return nil
	}
	_, err := tx.Exec(ctx, `
        INSERT INTO inventory_levels (variant_id, location_id, committed, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (variant_id, location_id)
        DO UPDATE SET committed = inventory_levels.committed + $3, updated_at = now()
    `, variantID, locationID, qty)
	return err
}

// Release decrements committed at the recorded location. Floors at zero —
// a stuck-positive count is recoverable by manual adjustment, but a
// stuck-negative one breaks the available formula in confusing ways.
func Release(ctx context.Context, tx pgx.Tx, variantID, locationID string, qty int) error {
	if locationID == "" || qty <= 0 {
		return nil
	}
	_, err := tx.Exec(ctx, `
        UPDATE inventory_levels
        SET committed = GREATEST(committed - $3, 0), updated_at = now()
        WHERE variant_id = $1 AND location_id = $2
    `, variantID, locationID, qty)
	return err
}
