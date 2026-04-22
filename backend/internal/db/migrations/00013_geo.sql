-- +goose Up
-- +goose StatementBegin

-- Stamp the detected country on each analytics session. We resolve it from
-- the request (Cloudflare / Fly.io country header in prod, Accept-Language
-- fallback in dev) the first time the session is upserted. Later events on
-- the same session don't overwrite the value — a visitor tunnelling through
-- a VPN after a few page views shouldn't flip their "from" country.
ALTER TABLE analytics_sessions ADD COLUMN country CHAR(2) NOT NULL DEFAULT '';
CREATE INDEX analytics_sessions_country_lastseen_idx
    ON analytics_sessions (country, last_seen DESC)
    WHERE country <> '';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
ALTER TABLE analytics_sessions DROP COLUMN IF EXISTS country;
-- +goose StatementEnd
