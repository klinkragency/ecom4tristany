-- +goose Up
-- +goose StatementBegin

-- ─── Discounts ──────────────────────────────────────────────────────────
--
-- One row per promotion. code IS NULL means the discount is *automatic*
-- (evaluated on every cart without the buyer entering anything). code IS
-- NOT NULL means the buyer must type it at checkout.
--
-- `kind` fully determines which other fields are meaningful:
--   percentage    → value_percent
--   amount        → value_cents
--   free_shipping → (no extra fields)
--   bogo          → bogo_* fields (classic buy-X-get-Y discount)
--
-- `scope` determines which *target* products are discounted:
--   all          → entire order
--   products     → join via discount_products (list='apply')
--   collections  → join via discount_collections (list='apply')
--
-- For BOGO, `scope` is ignored; the engine uses the bogo_*_scope columns
-- to drive the "which items count as buys" and "which items get the discount"
-- lookups via lists 'buy' and 'get' in the same join tables.
CREATE TABLE discounts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                        CITEXT UNIQUE,            -- NULL = automatic
    title                       TEXT NOT NULL,
    kind                        TEXT NOT NULL CHECK (kind IN ('percentage','amount','free_shipping','bogo')),

    -- Simple-type values
    value_percent               NUMERIC(5,2),
    value_cents                 INTEGER,

    -- Scope (where the discount lands — for non-BOGO)
    scope                       TEXT NOT NULL DEFAULT 'all'
                                CHECK (scope IN ('all','products','collections')),

    -- Customer eligibility
    eligibility                 TEXT NOT NULL DEFAULT 'all'
                                CHECK (eligibility IN ('all','segments')),

    -- Usage caps
    usage_limit                 INTEGER,
    usage_limit_per_customer    INTEGER,
    min_subtotal_cents          INTEGER NOT NULL DEFAULT 0,
    usage_count                 INTEGER NOT NULL DEFAULT 0,

    -- BOGO
    bogo_buy_quantity           INTEGER,
    bogo_get_quantity           INTEGER,
    bogo_get_discount_percent   NUMERIC(5,2),
    bogo_buy_scope              TEXT CHECK (bogo_buy_scope IN ('products','collections')),
    bogo_get_scope              TEXT CHECK (bogo_get_scope IN ('products','collections')),

    -- Flags + lifecycle
    active                      BOOLEAN NOT NULL DEFAULT true,
    starts_at                   TIMESTAMPTZ,
    ends_at                     TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX discounts_code_idx   ON discounts (code) WHERE code IS NOT NULL;
CREATE INDEX discounts_active_idx ON discounts (active, code);

-- Target lists: 'apply' = targets of a non-BOGO discount; 'buy'/'get' for BOGO.
CREATE TABLE discount_products (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    list        TEXT NOT NULL CHECK (list IN ('apply','buy','get')),
    PRIMARY KEY (discount_id, product_id, list)
);

CREATE TABLE discount_collections (
    discount_id   UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    list          TEXT NOT NULL CHECK (list IN ('apply','buy','get')),
    PRIMARY KEY (discount_id, collection_id, list)
);

CREATE TABLE discount_segments (
    discount_id UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    segment_id  UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
    PRIMARY KEY (discount_id, segment_id)
);

-- Each order-application is recorded so we can enforce per-customer limits
-- and so finance reports can tell you exactly what each discount cost.
CREATE TABLE discount_usages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id    UUID NOT NULL REFERENCES discounts(id) ON DELETE CASCADE,
    order_id       UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    customer_id    UUID REFERENCES customers(id) ON DELETE SET NULL,
    applied_cents  INTEGER NOT NULL,
    code_snapshot  TEXT NOT NULL DEFAULT '',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX discount_usages_discount_idx ON discount_usages (discount_id, created_at DESC);
CREATE INDEX discount_usages_order_idx    ON discount_usages (order_id);
CREATE INDEX discount_usages_customer_idx ON discount_usages (customer_id);

-- A cart can carry one code at a time (simplification: one code per cart,
-- but automatic discounts stack on top at checkout). Codes are stored on
-- the cart so they survive page reloads without re-typing.
ALTER TABLE carts ADD COLUMN discount_code CITEXT;

-- Snapshot the human-readable title on the order (in case the discount is
-- later renamed or deleted, the receipt still says what applied).
ALTER TABLE orders ADD COLUMN discount_code     CITEXT;
ALTER TABLE orders ADD COLUMN discount_title    TEXT NOT NULL DEFAULT '';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders DROP COLUMN IF EXISTS discount_title;
ALTER TABLE orders DROP COLUMN IF EXISTS discount_code;
ALTER TABLE carts  DROP COLUMN IF EXISTS discount_code;
DROP TABLE IF EXISTS discount_usages;
DROP TABLE IF EXISTS discount_segments;
DROP TABLE IF EXISTS discount_collections;
DROP TABLE IF EXISTS discount_products;
DROP TABLE IF EXISTS discounts;
-- +goose StatementEnd
