-- +goose Up
-- +goose StatementBegin

-- ─── Metaobject types (schemas) ─────────────────────────────────────────
--
-- Each type is a user-defined content type, e.g. "Size Chart", "FAQ Item",
-- "Team Member", "Location". The field_defs column stores the schema as
-- a JSON array of { key, name, type, required, help } objects. We keep
-- the schema in jsonb (rather than a separate fields table) so the admin
-- can reorder/rename/tweak the schema in one atomic UPDATE, and entries
-- can be validated in Go with a single DB hit.
--
-- Known field types (enforced in Go):
--   single_line_text | multi_line_text | rich_text | number | boolean
--   url | file | date | color
CREATE TABLE metaobject_types (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle      CITEXT NOT NULL UNIQUE,  -- stable identifier, e.g. 'size_chart'
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    field_defs  JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Metaobject entries (instances) ─────────────────────────────────────
--
-- An entry is one row of a type. `fields` holds { [field_key]: value }
-- validated against the parent type's field_defs at save time. `handle`
-- is unique within a type so the storefront can do /metaobjects/faq/shipping
-- style lookups.
CREATE TABLE metaobject_entries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_id      UUID NOT NULL REFERENCES metaobject_types(id) ON DELETE CASCADE,
    handle       CITEXT NOT NULL,
    name         TEXT NOT NULL,
    fields       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status       TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','published')),
    published_at TIMESTAMPTZ,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (type_id, handle)
);
CREATE INDEX metaobject_entries_type_status_idx ON metaobject_entries (type_id, status, position);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS metaobject_entries;
DROP TABLE IF EXISTS metaobject_types;
-- +goose StatementEnd
