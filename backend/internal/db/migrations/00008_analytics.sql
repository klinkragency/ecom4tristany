-- +goose Up
-- +goose StatementBegin

-- ─── Anonymous session tracking ─────────────────────────────────────────
--
-- A lightweight "who is browsing right now" concept, distinct from the
-- authentication session. An anonymous session ID lives in a cookie and is
-- attached to every analytics event so we can compute funnels
-- (view → cart → checkout → paid) without an account. When the buyer signs
-- in we don't rotate the session — we just attach their customer_id to the
-- same session so conversions span the login boundary.
--
-- sessions here live in-memory logically; we persist rows only when we need
-- to join to customer_id (i.e. at login time) so the table stays small.
CREATE TABLE analytics_sessions (
    id           TEXT PRIMARY KEY,           -- 43-char base64 url-safe from rand.Read(32)
    customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_first     TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX analytics_sessions_customer_idx ON analytics_sessions (customer_id);

-- ─── Events ─────────────────────────────────────────────────────────────
--
-- One row per tracked interaction. `kind` is a free-form but well-known set:
--   page_view, product_view, cart_add, cart_remove, cart_update,
--   checkout_started, checkout_completed, order_paid, order_refunded
--
-- Server-side events (order_paid, order_refunded) are written directly by
-- the relevant handlers so they don't require the browser to be online when
-- the webhook fires.
CREATE TABLE analytics_events (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind         TEXT NOT NULL,
    session_id   TEXT REFERENCES analytics_sessions(id) ON DELETE SET NULL,
    customer_id  UUID REFERENCES customers(id) ON DELETE SET NULL,
    cart_id      UUID REFERENCES carts(id) ON DELETE SET NULL,
    order_id     UUID REFERENCES orders(id) ON DELETE SET NULL,
    product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
    variant_id   UUID REFERENCES variants(id) ON DELETE SET NULL,
    url          TEXT NOT NULL DEFAULT '',
    referrer     TEXT NOT NULL DEFAULT '',
    user_agent   TEXT NOT NULL DEFAULT '',
    ip           TEXT NOT NULL DEFAULT '',
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_kind_time_idx   ON analytics_events (kind, occurred_at DESC);
CREATE INDEX analytics_events_session_idx     ON analytics_events (session_id, occurred_at);
CREATE INDEX analytics_events_customer_idx    ON analytics_events (customer_id, occurred_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX analytics_events_product_idx     ON analytics_events (product_id, occurred_at DESC) WHERE product_id IS NOT NULL;
CREATE INDEX analytics_events_order_idx       ON analytics_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX analytics_events_occurred_at_idx ON analytics_events (occurred_at DESC);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS analytics_events;
DROP TABLE IF EXISTS analytics_sessions;
-- +goose StatementEnd
