-- +goose Up
-- +goose StatementBegin

-- ─── Carts ───────────────────────────────────────────────────────────────

CREATE TABLE carts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
    -- `token` identifies anonymous carts via an HttpOnly cookie. NULL once a cart
    -- is attached to a customer (either the customer logged in and merged it,
    -- or it was created directly for an authenticated customer).
    token        TEXT UNIQUE,
    currency     TEXT NOT NULL DEFAULT 'EUR',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (customer_id IS NOT NULL OR token IS NOT NULL)
);
CREATE INDEX carts_customer_idx ON carts (customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE cart_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cart_id    UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    quantity   INTEGER NOT NULL CHECK (quantity > 0),
    added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (cart_id, variant_id)
);

-- ─── Orders ──────────────────────────────────────────────────────────────

CREATE SEQUENCE order_number_seq START 1000;

CREATE TABLE orders (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    number               TEXT NOT NULL UNIQUE DEFAULT ('#' || nextval('order_number_seq')),
    customer_id          UUID REFERENCES customers(id) ON DELETE SET NULL,
    email                TEXT NOT NULL,
    phone                TEXT NOT NULL DEFAULT '',
    currency             TEXT NOT NULL DEFAULT 'EUR',

    -- Overall status — derived, but cached for fast listing / filtering.
    status               TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','partially_paid','fulfilled','partially_fulfilled','cancelled','refunded','partially_refunded')),
    financial_status     TEXT NOT NULL DEFAULT 'pending'
        CHECK (financial_status IN ('pending','authorized','paid','partially_paid','refunded','partially_refunded','voided')),
    fulfillment_status   TEXT NOT NULL DEFAULT 'unfulfilled'
        CHECK (fulfillment_status IN ('unfulfilled','partial','fulfilled','restocked')),

    -- Money, all in cents and in `currency`.
    subtotal_cents       INTEGER NOT NULL DEFAULT 0,  -- sum of line item totals (pre-discount, pre-tax)
    discount_cents       INTEGER NOT NULL DEFAULT 0,
    tax_cents            INTEGER NOT NULL DEFAULT 0,
    shipping_cents       INTEGER NOT NULL DEFAULT 0,
    total_cents          INTEGER NOT NULL DEFAULT 0,

    -- Denormalized convenience fields.
    note                 TEXT NOT NULL DEFAULT '',
    referrer             TEXT NOT NULL DEFAULT '',
    landing_page         TEXT NOT NULL DEFAULT '',
    utm                  JSONB,

    ip                   TEXT NOT NULL DEFAULT '',
    user_agent           TEXT NOT NULL DEFAULT '',

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    paid_at              TIMESTAMPTZ,
    fulfilled_at         TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ
);
CREATE INDEX orders_customer_idx    ON orders (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX orders_created_idx     ON orders (created_at DESC);
CREATE INDEX orders_status_idx      ON orders (status, created_at DESC);
CREATE INDEX orders_financial_idx   ON orders (financial_status, created_at DESC);

CREATE TABLE order_tags (
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tag      CITEXT NOT NULL,
    PRIMARY KEY (order_id, tag)
);

-- Line items keep a full snapshot so changes to the product catalog don't mutate history.
CREATE TABLE order_line_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id          UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    variant_id        UUID REFERENCES variants(id) ON DELETE SET NULL,
    product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
    product_title     TEXT NOT NULL,
    variant_title     TEXT NOT NULL DEFAULT '',
    sku               TEXT NOT NULL DEFAULT '',
    image_url         TEXT NOT NULL DEFAULT '',
    unit_price_cents  INTEGER NOT NULL,
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    subtotal_cents    INTEGER NOT NULL, -- unit_price * quantity
    discount_cents    INTEGER NOT NULL DEFAULT 0,
    tax_cents         INTEGER NOT NULL DEFAULT 0,
    total_cents       INTEGER NOT NULL, -- subtotal - discount + tax
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_line_items_order_idx ON order_line_items (order_id);

CREATE TABLE order_addresses (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind           TEXT NOT NULL CHECK (kind IN ('shipping','billing')),
    first_name     TEXT NOT NULL DEFAULT '',
    last_name      TEXT NOT NULL DEFAULT '',
    company        TEXT NOT NULL DEFAULT '',
    address_line1  TEXT NOT NULL DEFAULT '',
    address_line2  TEXT NOT NULL DEFAULT '',
    city           TEXT NOT NULL DEFAULT '',
    region         TEXT NOT NULL DEFAULT '',
    postal_code    TEXT NOT NULL DEFAULT '',
    country        TEXT NOT NULL DEFAULT '',
    phone          TEXT NOT NULL DEFAULT '',
    UNIQUE (order_id, kind)
);

-- ─── Payments ────────────────────────────────────────────────────────────

CREATE TABLE payments (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider       TEXT NOT NULL,   -- 'stripe', 'manual'
    provider_ref   TEXT,             -- e.g. Stripe PaymentIntent id
    status         TEXT NOT NULL,    -- requires_action, authorized, captured, voided, failed, …
    amount_cents   INTEGER NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'EUR',
    last4          TEXT NOT NULL DEFAULT '',
    brand          TEXT NOT NULL DEFAULT '',
    raw            JSONB,            -- raw provider payload for debugging
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE UNIQUE INDEX payments_provider_ref_idx ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;

-- ─── Refunds ─────────────────────────────────────────────────────────────

CREATE TABLE refunds (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    payment_id     UUID REFERENCES payments(id) ON DELETE SET NULL,
    provider_ref   TEXT,
    amount_cents   INTEGER NOT NULL,
    currency       TEXT NOT NULL DEFAULT 'EUR',
    reason         TEXT NOT NULL DEFAULT '',
    note           TEXT NOT NULL DEFAULT '',
    created_by     UUID REFERENCES admin_users(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refunds_order_idx ON refunds (order_id);

CREATE TABLE refund_line_items (
    refund_id       UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
    line_item_id    UUID NOT NULL REFERENCES order_line_items(id),
    quantity        INTEGER NOT NULL CHECK (quantity > 0),
    amount_cents    INTEGER NOT NULL,
    restock         BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (refund_id, line_item_id)
);

-- ─── Order timeline (simple audit trail) ─────────────────────────────────

CREATE TABLE order_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id   UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,       -- created, paid, cancelled, note_added, refunded, …
    admin_id   UUID REFERENCES admin_users(id),
    payload    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, created_at DESC);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS order_events;
DROP TABLE IF EXISTS refund_line_items;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS order_addresses;
DROP TABLE IF EXISTS order_line_items;
DROP TABLE IF EXISTS order_tags;
DROP TABLE IF EXISTS orders;
DROP SEQUENCE IF EXISTS order_number_seq;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS carts;
-- +goose StatementEnd
