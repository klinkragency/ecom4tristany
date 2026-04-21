-- +goose Up
-- +goose StatementBegin

-- Active currencies on the storefront. DISPLAY-only for now — orders are
-- still created in the shop's base currency (cfg.ShopCurrency). The
-- exchange_rate is the number of {code} units per 1 base unit (e.g. if
-- base is EUR and USD rate is 1.08, 1 EUR = 1.08 USD).
--
-- Exactly one row has is_base = true; the constraint below enforces it.
CREATE TABLE currencies (
    code            CHAR(3)       PRIMARY KEY CHECK (code = upper(code)),
    symbol          TEXT          NOT NULL,
    symbol_position TEXT          NOT NULL DEFAULT 'after'
                                  CHECK (symbol_position IN ('before','after')),
    decimal_places  INTEGER       NOT NULL DEFAULT 2 CHECK (decimal_places BETWEEN 0 AND 4),
    exchange_rate   NUMERIC(16,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
    active          BOOLEAN       NOT NULL DEFAULT true,
    is_base         BOOLEAN       NOT NULL DEFAULT false,
    position        INTEGER       NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Exactly one base currency. Partial unique index.
CREATE UNIQUE INDEX currencies_one_base_idx ON currencies ((1)) WHERE is_base;

-- Seed EUR as the base + a few common additions. Rates are indicative as of
-- 2026 and the admin edits them freely from /settings/currencies.
INSERT INTO currencies (code, symbol, symbol_position, decimal_places, exchange_rate, is_base, position) VALUES
    ('EUR', '€', 'after',  2, 1.00000000, true,  0),
    ('USD', '$', 'before', 2, 1.08000000, false, 1),
    ('GBP', '£', 'before', 2, 0.85000000, false, 2),
    ('CHF', 'CHF ', 'before', 2, 0.96000000, false, 3)
ON CONFLICT (code) DO NOTHING;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS currencies;
-- +goose StatementEnd
