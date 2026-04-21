-- +goose Up
-- +goose StatementBegin

-- Per-country VAT rates. At checkout we resolve the rate using the shipping
-- address country; if no row exists for that country, we fall back to the
-- shop's default SHOP_VAT_PERCENT (kept in config + overridable via the
-- shop_settings key `shop.vat_percent`).
--
-- NUMERIC(5,2) gives us two decimals (e.g. 20.00) and enough room for any
-- plausible national VAT rate.
CREATE TABLE tax_rates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    country    CHAR(2) NOT NULL UNIQUE CHECK (country = upper(country)),
    percent    NUMERIC(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
    name       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed standard VAT rates for all 27 EU member states (standard rate only —
-- reduced rates per product category would be Phase 10b). Source: EU
-- Commission TEDB as of 2026. Edit these in the admin if they change.
INSERT INTO tax_rates (country, percent, name) VALUES
    ('AT', 20, 'Austria'),
    ('BE', 21, 'Belgium'),
    ('BG', 20, 'Bulgaria'),
    ('HR', 25, 'Croatia'),
    ('CY', 19, 'Cyprus'),
    ('CZ', 21, 'Czech Republic'),
    ('DK', 25, 'Denmark'),
    ('EE', 22, 'Estonia'),
    ('FI', 25.5, 'Finland'),
    ('FR', 20, 'France'),
    ('DE', 19, 'Germany'),
    ('GR', 24, 'Greece'),
    ('HU', 27, 'Hungary'),
    ('IE', 23, 'Ireland'),
    ('IT', 22, 'Italy'),
    ('LV', 21, 'Latvia'),
    ('LT', 21, 'Lithuania'),
    ('LU', 17, 'Luxembourg'),
    ('MT', 18, 'Malta'),
    ('NL', 21, 'Netherlands'),
    ('PL', 23, 'Poland'),
    ('PT', 23, 'Portugal'),
    ('RO', 19, 'Romania'),
    ('SK', 23, 'Slovakia'),
    ('SI', 22, 'Slovenia'),
    ('ES', 21, 'Spain'),
    ('SE', 25, 'Sweden'),
    -- Non-EU but common European destinations
    ('GB', 20, 'United Kingdom'),
    ('CH', 8.1, 'Switzerland'),
    ('NO', 25, 'Norway')
ON CONFLICT (country) DO NOTHING;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS tax_rates;
-- +goose StatementEnd
