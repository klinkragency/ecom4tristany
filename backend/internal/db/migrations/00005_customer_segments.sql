-- +goose Up
-- +goose StatementBegin

-- Saved admin filters on the customer table. Dynamic: rules are evaluated at
-- query time (no materialized membership). Phase 6 will reuse these for
-- discount targeting; Phase 10 (email campaigns) for marketing lists.
CREATE TABLE customer_segments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    match_all    BOOLEAN NOT NULL DEFAULT true,           -- AND vs OR between rules
    created_by   UUID REFERENCES admin_users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_segment_rules (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    segment_id UUID NOT NULL REFERENCES customer_segments(id) ON DELETE CASCADE,
    field      TEXT NOT NULL CHECK (field IN (
                   'email','first_name','last_name',
                   'total_spent','order_count','last_order_days',
                   'tag','marketing_consent','country','created_days')),
    operator   TEXT NOT NULL CHECK (operator IN (
                   'equals','not_equals','contains','not_contains',
                   'starts_with','ends_with',
                   'greater_than','less_than',
                   'is_true','is_false',
                   'is_null','is_not_null')),
    value      TEXT NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX customer_segment_rules_segment_idx ON customer_segment_rules (segment_id, position);

-- Record erasure events for auditability. Soft tombstone: the row points at
-- an anonymized customer, keeps the original email hash so a repeated erase
-- request lands no-op, and explains *who* asked (customer vs admin).
CREATE TABLE customer_erasures (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id   UUID REFERENCES customers(id) ON DELETE SET NULL,
    original_email_hash TEXT NOT NULL,       -- sha256 of original email lowercased
    erased_by     TEXT NOT NULL,              -- 'customer' | 'admin'
    admin_id      UUID REFERENCES admin_users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_erasures_hash_idx ON customer_erasures (original_email_hash);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS customer_erasures;
DROP TABLE IF EXISTS customer_segment_rules;
DROP TABLE IF EXISTS customer_segments;
-- +goose StatementEnd
