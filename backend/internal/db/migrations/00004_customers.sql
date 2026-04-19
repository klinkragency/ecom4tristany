-- +goose Up
-- +goose StatementBegin

-- Add a few missing columns on customers (phone, admin-only note, marketing consent).
ALTER TABLE customers
    ADD COLUMN phone             TEXT NOT NULL DEFAULT '',
    ADD COLUMN note              TEXT NOT NULL DEFAULT '',
    ADD COLUMN marketing_consent BOOLEAN NOT NULL DEFAULT false;

-- ─── Customer address book ──────────────────────────────────────────────
-- Saved addresses the customer can pick from at checkout. Distinct from the
-- snapshots on `order_addresses` (those are frozen at purchase).
CREATE TABLE customer_addresses (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label               TEXT NOT NULL DEFAULT '',          -- "Home", "Office"
    first_name          TEXT NOT NULL DEFAULT '',
    last_name           TEXT NOT NULL DEFAULT '',
    company             TEXT NOT NULL DEFAULT '',
    address_line1       TEXT NOT NULL DEFAULT '',
    address_line2       TEXT NOT NULL DEFAULT '',
    city                TEXT NOT NULL DEFAULT '',
    region              TEXT NOT NULL DEFAULT '',
    postal_code         TEXT NOT NULL DEFAULT '',
    country             TEXT NOT NULL DEFAULT '',
    phone               TEXT NOT NULL DEFAULT '',
    is_default_shipping BOOLEAN NOT NULL DEFAULT false,
    is_default_billing  BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_customer_idx ON customer_addresses (customer_id);
-- Enforce at most one default per kind, per customer. Partial unique index.
CREATE UNIQUE INDEX customer_addresses_default_shipping_unique
    ON customer_addresses (customer_id) WHERE is_default_shipping;
CREATE UNIQUE INDEX customer_addresses_default_billing_unique
    ON customer_addresses (customer_id) WHERE is_default_billing;

-- ─── Customer tags (admin-managed CRM labels) ───────────────────────────
CREATE TABLE customer_tags (
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    tag         CITEXT NOT NULL,
    PRIMARY KEY (customer_id, tag)
);
CREATE INDEX customer_tags_tag_idx ON customer_tags (tag);

-- ─── Password reset tokens ──────────────────────────────────────────────
-- The token is sha256(secret). The customer receives the secret by email and
-- sends it back to complete the reset. This way a DB leak never exposes live tokens.
CREATE TABLE customer_password_resets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip          TEXT NOT NULL DEFAULT '',
    user_agent  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX customer_password_resets_customer_idx ON customer_password_resets (customer_id);

-- ─── Store credit ───────────────────────────────────────────────────────
-- One account per customer. `balance_cents` is cached for speed; it MUST equal
-- SUM(delta_cents) from the ledger (enforced by a trigger below).
CREATE TABLE store_credit_accounts (
    customer_id   UUID PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
    balance_cents INTEGER NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT 'EUR',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger (double-entry). Positive delta = credit granted. Negative = debit (spent).
-- reason: grant, refund, purchase, adjustment, expiration, promotional.
CREATE TABLE store_credit_ledger (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    delta_cents INTEGER NOT NULL CHECK (delta_cents <> 0),
    reason      TEXT NOT NULL CHECK (reason IN ('grant','refund','purchase','adjustment','expiration','promotional')),
    note        TEXT NOT NULL DEFAULT '',
    order_id    UUID REFERENCES orders(id) ON DELETE SET NULL,
    admin_id    UUID REFERENCES admin_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX store_credit_ledger_customer_idx ON store_credit_ledger (customer_id, created_at DESC);

-- Trigger: each ledger insert updates the account balance atomically.
CREATE OR REPLACE FUNCTION store_credit_apply_delta() RETURNS trigger AS $$
BEGIN
    INSERT INTO store_credit_accounts (customer_id, balance_cents)
    VALUES (NEW.customer_id, NEW.delta_cents)
    ON CONFLICT (customer_id) DO UPDATE
      SET balance_cents = store_credit_accounts.balance_cents + NEW.delta_cents,
          updated_at = now();

    -- Guard against negative balance (we reject overdrafts at the API layer
    -- but this is a belt-and-suspenders invariant).
    IF (SELECT balance_cents FROM store_credit_accounts WHERE customer_id = NEW.customer_id) < 0 THEN
        RAISE EXCEPTION 'store credit balance would go negative for customer %', NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER store_credit_ledger_apply_delta
    AFTER INSERT ON store_credit_ledger
    FOR EACH ROW EXECUTE FUNCTION store_credit_apply_delta();

-- Orders: add an optional store_credit_cents column so checkout can deduct
-- store credit alongside the card payment.
ALTER TABLE orders
    ADD COLUMN store_credit_cents INTEGER NOT NULL DEFAULT 0;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
ALTER TABLE orders DROP COLUMN IF EXISTS store_credit_cents;
DROP TRIGGER IF EXISTS store_credit_ledger_apply_delta ON store_credit_ledger;
DROP FUNCTION IF EXISTS store_credit_apply_delta();
DROP TABLE IF EXISTS store_credit_ledger;
DROP TABLE IF EXISTS store_credit_accounts;
DROP TABLE IF EXISTS customer_password_resets;
DROP TABLE IF EXISTS customer_tags;
DROP TABLE IF EXISTS customer_addresses;
ALTER TABLE customers
    DROP COLUMN IF EXISTS marketing_consent,
    DROP COLUMN IF EXISTS note,
    DROP COLUMN IF EXISTS phone;
-- +goose StatementEnd
