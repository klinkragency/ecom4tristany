-- +goose Up
-- +goose StatementBegin

-- ─── Extend admin_users for invites + first-login reset ─────────────────
ALTER TABLE admin_users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE admin_users ADD COLUMN invited_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
ALTER TABLE admin_users ADD COLUMN invited_at TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN last_login_at TIMESTAMPTZ;

-- Tighten the role CHECK constraint. Existing seeded admins will be 'owner'
-- which is allowed, so the constraint won't fail on apply.
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check
    CHECK (role IN ('owner','admin','staff'));

-- Invite tokens — same pattern as customer_password_resets. Invited admin
-- clicks the link, sets their first password, then the token is consumed.
CREATE TABLE admin_invites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL,               -- sha256 of the plaintext secret
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_invites_token_idx ON admin_invites (token_hash);
CREATE INDEX admin_invites_admin_idx ON admin_invites (admin_id);

-- ─── Audit log ──────────────────────────────────────────────────────────
-- One row per admin-originated mutation. Reads aren't logged (volume
-- would drown the useful entries). `payload_redacted` is the request body
-- with known-sensitive keys stripped (passwords, tokens).
CREATE TABLE admin_audit_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id         UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    admin_email      TEXT NOT NULL DEFAULT '',    -- snapshot
    method           TEXT NOT NULL,               -- POST|PUT|PATCH|DELETE
    path             TEXT NOT NULL,
    status           INTEGER NOT NULL DEFAULT 0,
    resource_type    TEXT NOT NULL DEFAULT '',    -- products|orders|customers|…
    resource_id      TEXT NOT NULL DEFAULT '',
    ip               TEXT NOT NULL DEFAULT '',
    user_agent       TEXT NOT NULL DEFAULT '',
    payload_redacted JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_admin_idx    ON admin_audit_log (admin_id, created_at DESC);
CREATE INDEX admin_audit_log_resource_idx ON admin_audit_log (resource_type, resource_id, created_at DESC);
CREATE INDEX admin_audit_log_created_idx  ON admin_audit_log (created_at DESC);

-- ─── Shop settings ──────────────────────────────────────────────────────
-- Key-value table so new settings never need schema migrations. The
-- settings layer resolves in order: DB row → env var → hardcoded default.
CREATE TABLE shop_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS shop_settings;
DROP TABLE IF EXISTS admin_audit_log;
DROP TABLE IF EXISTS admin_invites;
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users DROP COLUMN IF EXISTS last_login_at;
ALTER TABLE admin_users DROP COLUMN IF EXISTS invited_at;
ALTER TABLE admin_users DROP COLUMN IF EXISTS invited_by;
ALTER TABLE admin_users DROP COLUMN IF EXISTS must_change_password;
-- +goose StatementEnd
