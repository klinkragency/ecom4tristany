-- +goose Up
-- +goose StatementBegin

-- ─── Products ────────────────────────────────────────────────────────────
CREATE TABLE products (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle           CITEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    description_html TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
    vendor           TEXT NOT NULL DEFAULT '',
    product_type     TEXT NOT NULL DEFAULT '',
    tax_status       TEXT NOT NULL DEFAULT 'taxable' CHECK (tax_status IN ('taxable','non_taxable')),
    weight_grams     INTEGER NOT NULL DEFAULT 0,
    hs_code          TEXT NOT NULL DEFAULT '',
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX products_status_idx    ON products (status);
CREATE INDEX products_created_idx   ON products (created_at DESC);
CREATE INDEX products_published_idx ON products (published_at) WHERE status = 'active';

CREATE TABLE product_tags (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tag        CITEXT NOT NULL,
    PRIMARY KEY (product_id, tag)
);
CREATE INDEX product_tags_tag_idx ON product_tags (tag);

-- ─── Options / Option values ─────────────────────────────────────────────
CREATE TABLE product_options (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL DEFAULT 0,
    name        TEXT NOT NULL,
    UNIQUE (product_id, position),
    UNIQUE (product_id, name)
);

CREATE TABLE option_values (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id UUID NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL DEFAULT 0,
    value     TEXT NOT NULL,
    UNIQUE (option_id, value)
);

-- ─── Variants ────────────────────────────────────────────────────────────
CREATE TABLE variants (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    sku                  TEXT NOT NULL DEFAULT '',
    barcode              TEXT NOT NULL DEFAULT '',
    price_cents          INTEGER NOT NULL DEFAULT 0,
    compare_at_cents     INTEGER,
    cost_cents           INTEGER,
    weight_grams         INTEGER NOT NULL DEFAULT 0,
    position             INTEGER NOT NULL DEFAULT 0,
    track_inventory      BOOLEAN NOT NULL DEFAULT true,
    continue_selling_oos BOOLEAN NOT NULL DEFAULT false,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX variants_product_idx ON variants (product_id, position);
CREATE UNIQUE INDEX variants_sku_unique ON variants (sku) WHERE sku <> '';

CREATE TABLE variant_option_values (
    variant_id UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    option_id  UUID NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
    value_id   UUID NOT NULL REFERENCES option_values(id) ON DELETE CASCADE,
    PRIMARY KEY (variant_id, option_id)
);
CREATE INDEX vov_value_idx ON variant_option_values (value_id);

-- ─── Media ───────────────────────────────────────────────────────────────
CREATE TABLE product_media (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    variant_id  UUID REFERENCES variants(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL DEFAULT 'image' CHECK (kind IN ('image','video','model3d')),
    object_key  TEXT NOT NULL,
    url         TEXT NOT NULL,
    alt         TEXT NOT NULL DEFAULT '',
    width       INTEGER,
    height      INTEGER,
    bytes       INTEGER,
    mime        TEXT NOT NULL DEFAULT '',
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_media_product_idx ON product_media (product_id, position);

-- ─── Locations ───────────────────────────────────────────────────────────
CREATE TABLE locations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_fulfillment  BOOLEAN NOT NULL DEFAULT true,
    address_line1   TEXT NOT NULL DEFAULT '',
    address_line2   TEXT NOT NULL DEFAULT '',
    city            TEXT NOT NULL DEFAULT '',
    region          TEXT NOT NULL DEFAULT '',
    postal_code     TEXT NOT NULL DEFAULT '',
    country         TEXT NOT NULL DEFAULT '',
    phone           TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed a default location so Phase 2 works out of the box.
INSERT INTO locations (name, is_active, is_fulfillment) VALUES ('Main Warehouse', true, true);

-- ─── Inventory ───────────────────────────────────────────────────────────
CREATE TABLE inventory_levels (
    variant_id   UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    on_hand      INTEGER NOT NULL DEFAULT 0,
    committed    INTEGER NOT NULL DEFAULT 0,
    incoming     INTEGER NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (variant_id, location_id)
);

CREATE TABLE inventory_adjustments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id   UUID NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
    location_id  UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
    delta        INTEGER NOT NULL,
    reason       TEXT NOT NULL CHECK (reason IN ('received','damaged','theft','correction','count','transfer','other')),
    note         TEXT NOT NULL DEFAULT '',
    admin_id     UUID NOT NULL REFERENCES admin_users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inv_adj_variant_idx ON inventory_adjustments (variant_id, created_at DESC);

CREATE TABLE stock_transfers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_location   UUID NOT NULL REFERENCES locations(id),
    to_location     UUID NOT NULL REFERENCES locations(id),
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_transit','received','cancelled')),
    note            TEXT NOT NULL DEFAULT '',
    created_by      UUID NOT NULL REFERENCES admin_users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    shipped_at      TIMESTAMPTZ,
    received_at     TIMESTAMPTZ,
    CHECK (from_location <> to_location)
);

CREATE TABLE stock_transfer_items (
    transfer_id  UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    variant_id   UUID NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
    quantity     INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (transfer_id, variant_id)
);

-- ─── Collections ─────────────────────────────────────────────────────────
CREATE TABLE collections (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle           CITEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    description_html TEXT NOT NULL DEFAULT '',
    image_url        TEXT NOT NULL DEFAULT '',
    is_rules_based   BOOLEAN NOT NULL DEFAULT false,
    match_all        BOOLEAN NOT NULL DEFAULT true,                 -- AND vs OR
    sort_order       TEXT NOT NULL DEFAULT 'manual' CHECK (sort_order IN ('manual','best_selling','price_asc','price_desc','alpha_asc','alpha_desc','created_desc')),
    seo_title        TEXT NOT NULL DEFAULT '',
    seo_description  TEXT NOT NULL DEFAULT '',
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE collection_products (
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, product_id)
);
CREATE INDEX collection_products_pos_idx ON collection_products (collection_id, position);

CREATE TABLE collection_rules (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id  UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    field          TEXT NOT NULL CHECK (field IN ('title','vendor','product_type','tag','price','inventory','status')),
    operator       TEXT NOT NULL CHECK (operator IN ('equals','not_equals','contains','not_contains','starts_with','ends_with','greater_than','less_than','in_stock','out_of_stock')),
    value          TEXT NOT NULL DEFAULT '',
    position       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX collection_rules_collection_idx ON collection_rules (collection_id, position);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS collection_rules;
DROP TABLE IF EXISTS collection_products;
DROP TABLE IF EXISTS collections;
DROP TABLE IF EXISTS stock_transfer_items;
DROP TABLE IF EXISTS stock_transfers;
DROP TABLE IF EXISTS inventory_adjustments;
DROP TABLE IF EXISTS inventory_levels;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS product_media;
DROP TABLE IF EXISTS variant_option_values;
DROP TABLE IF EXISTS variants;
DROP TABLE IF EXISTS option_values;
DROP TABLE IF EXISTS product_options;
DROP TABLE IF EXISTS product_tags;
DROP TABLE IF EXISTS products;
-- +goose StatementEnd
