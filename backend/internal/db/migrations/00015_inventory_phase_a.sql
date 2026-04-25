-- +goose Up
-- Phase A inventory foundations.
--
-- We track which location's `committed` was bumped when an order line was
-- created so we can release the same row on cancel / fulfillment / refund —
-- without that, a cancel could double-decrement at the wrong location and
-- leave per-location committed counters wrong.
--
-- Nullable because:
--   - existing pre-migration line items have nothing to attribute,
--   - some shops may temporarily have zero fulfillment locations active
--     (we still create the order, just don't commit anywhere — `available`
--     is then equal to `on_hand`, which is fine for a single-location
--     transition state).

ALTER TABLE order_line_items
    ADD COLUMN committed_location_id UUID REFERENCES locations(id);

-- Index used by the inventory dashboard to compute totals quickly.
CREATE INDEX IF NOT EXISTS inventory_levels_variant_idx
    ON inventory_levels (variant_id);

-- +goose Down
DROP INDEX IF EXISTS inventory_levels_variant_idx;
ALTER TABLE order_line_items DROP COLUMN IF EXISTS committed_location_id;
