-- +goose Up
-- +goose StatementBegin

-- ─── Static CMS pages (About, FAQ, legal, …) ────────────────────────────
CREATE TABLE pages (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             CITEXT NOT NULL UNIQUE,
    title            TEXT NOT NULL,
    content_html     TEXT NOT NULL DEFAULT '',
    excerpt          TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','published')),
    published_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX pages_status_idx ON pages (status, published_at DESC);

-- ─── Navigation menus ───────────────────────────────────────────────────
-- `handle` is the stable identifier the storefront queries by, e.g.
-- "main" (header) or "footer". A shop typically has 2-3 menus total.
CREATE TABLE menus (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    handle     CITEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menu items support 1-level nesting via parent_id (dropdowns). Keeping
-- deeper trees out of scope — the rare cases are better modelled as two
-- separate menus. link_type drives how `target` resolves at render time.
CREATE TABLE menu_items (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    menu_id    UUID NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
    parent_id  UUID REFERENCES menu_items(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL DEFAULT 0,
    label      TEXT NOT NULL,
    link_type  TEXT NOT NULL
               CHECK (link_type IN ('url','page','collection','product','blog','blog_post','menu_header')),
    target     TEXT NOT NULL DEFAULT '',  -- slug / handle / URL depending on link_type
    open_in_new_tab BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX menu_items_menu_idx ON menu_items (menu_id, parent_id, position);

-- Seed the two menus every storefront needs so the admin UI has something
-- to edit out of the box. They start empty; the admin populates them.
INSERT INTO menus (handle, name) VALUES
    ('main',   'Header navigation'),
    ('footer', 'Footer navigation')
ON CONFLICT (handle) DO NOTHING;

-- ─── Blog ────────────────────────────────────────────────────────────────
CREATE TABLE blog_posts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                CITEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    excerpt             TEXT NOT NULL DEFAULT '',
    content_html        TEXT NOT NULL DEFAULT '',
    author_name         TEXT NOT NULL DEFAULT '',
    featured_image_url  TEXT NOT NULL DEFAULT '',
    meta_description    TEXT NOT NULL DEFAULT '',
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published')),
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX blog_posts_status_idx ON blog_posts (status, published_at DESC);

CREATE TABLE blog_post_tags (
    post_id UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    tag     CITEXT NOT NULL,
    PRIMARY KEY (post_id, tag)
);
CREATE INDEX blog_post_tags_tag_idx ON blog_post_tags (tag);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS blog_post_tags;
DROP TABLE IF EXISTS blog_posts;
DROP TABLE IF EXISTS menu_items;
DROP TABLE IF EXISTS menus;
DROP TABLE IF EXISTS pages;
-- +goose StatementEnd
