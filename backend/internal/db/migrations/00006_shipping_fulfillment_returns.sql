-- +goose Up
-- +goose StatementBegin

-- ─── Shipping zones & rates ──────────────────────────────────────────────
-- Zones group countries that share rate cards. One country can only belong
-- to one zone (enforced via UNIQUE on country).
CREATE TABLE shipping_zones (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE shipping_zone_countries (
    zone_id  UUID NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
    country  CHAR(2) NOT NULL CHECK (country = upper(country)),
    PRIMARY KEY (zone_id, country),
    UNIQUE (country)
);

-- A rate card is either flat (fixed cents) or weight-based (per-kg plus
-- optional minimum). free_over_cents sets a cart-subtotal threshold above
-- which shipping is free — leave NULL to disable. Inactive rates are hidden
-- from checkout but preserved for reporting.
CREATE TABLE shipping_rates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id         UUID NOT NULL REFERENCES shipping_zones(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('flat','weight')),
    flat_cents      INTEGER NOT NULL DEFAULT 0,
    per_kg_cents    INTEGER NOT NULL DEFAULT 0,
    min_cents       INTEGER NOT NULL DEFAULT 0,
    free_over_cents INTEGER,                          -- NULL means no free threshold
    active          BOOLEAN NOT NULL DEFAULT true,
    position        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipping_rates_zone_idx ON shipping_rates (zone_id, position);

-- Snapshot the selected rate name onto the order so admin/email templates
-- can show it without joining. The cents already live in orders.shipping_cents.
ALTER TABLE orders ADD COLUMN shipping_method TEXT NOT NULL DEFAULT '';

-- ─── Fulfillments ────────────────────────────────────────────────────────
-- A fulfillment is a shipment: one or more line items leaving from a single
-- location with a single tracking number. Orders can have many fulfillments
-- (partial shipments).
CREATE TABLE fulfillments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    location_id     UUID REFERENCES locations(id) ON DELETE SET NULL,
    number          INTEGER NOT NULL,                 -- 1, 2, … per order
    carrier         TEXT NOT NULL DEFAULT '',
    tracking_number TEXT NOT NULL DEFAULT '',
    tracking_url    TEXT NOT NULL DEFAULT '',
    shipped_at      TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,                      -- optional; reserved for tracking integrations
    status          TEXT NOT NULL DEFAULT 'shipped'
                    CHECK (status IN ('shipped','delivered','cancelled')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (order_id, number)
);
CREATE INDEX fulfillments_order_idx ON fulfillments (order_id);

CREATE TABLE fulfillment_line_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fulfillment_id  UUID NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
    order_line_item_id UUID NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    quantity        INTEGER NOT NULL CHECK (quantity > 0)
);
CREATE INDEX fulfillment_line_items_fulfillment_idx ON fulfillment_line_items (fulfillment_id);
CREATE INDEX fulfillment_line_items_line_idx ON fulfillment_line_items (order_line_item_id);

-- ─── Returns / RMA ───────────────────────────────────────────────────────
-- Auto-numbering sequence for human-readable RMA numbers (e.g. RMA-1001).
CREATE SEQUENCE rma_number_seq START 1001;

CREATE TABLE returns (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    rma_number    TEXT NOT NULL UNIQUE
                  DEFAULT 'RMA-' || nextval('rma_number_seq'),
    status        TEXT NOT NULL DEFAULT 'requested'
                  CHECK (status IN ('requested','approved','rejected','received','refunded','cancelled')),
    customer_note TEXT NOT NULL DEFAULT '',
    admin_note    TEXT NOT NULL DEFAULT '',
    refund_id     UUID REFERENCES refunds(id) ON DELETE SET NULL,
    requested_by  TEXT NOT NULL DEFAULT 'customer'   -- 'customer' | 'admin'
                  CHECK (requested_by IN ('customer','admin')),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at   TIMESTAMPTZ,
    received_at   TIMESTAMPTZ,
    refunded_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX returns_order_idx ON returns (order_id);
CREATE INDEX returns_status_idx ON returns (status);

CREATE TABLE return_line_items (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id          UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
    order_line_item_id UUID NOT NULL REFERENCES order_line_items(id) ON DELETE CASCADE,
    quantity           INTEGER NOT NULL CHECK (quantity > 0),
    reason             TEXT NOT NULL DEFAULT 'other'
                       CHECK (reason IN ('wrong_item','damaged','doesnt_fit','changed_mind','not_as_described','other')),
    note               TEXT NOT NULL DEFAULT '',
    restocked          BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX return_line_items_return_idx ON return_line_items (return_id);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS return_line_items;
DROP TABLE IF EXISTS returns;
DROP SEQUENCE IF EXISTS rma_number_seq;
DROP TABLE IF EXISTS fulfillment_line_items;
DROP TABLE IF EXISTS fulfillments;
ALTER TABLE orders DROP COLUMN IF EXISTS shipping_method;
DROP TABLE IF EXISTS shipping_rates;
DROP TABLE IF EXISTS shipping_zone_countries;
DROP TABLE IF EXISTS shipping_zones;
-- +goose StatementEnd
