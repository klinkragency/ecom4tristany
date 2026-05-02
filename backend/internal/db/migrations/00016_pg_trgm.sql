-- +goose Up
-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes power fast similarity / ILIKE-with-LIKE-prefix queries
-- on columns the admin search hits.
CREATE INDEX IF NOT EXISTS products_title_trgm     ON products USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_handle_trgm    ON products USING gin (handle gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_email_trgm    ON customers USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_name_trgm     ON customers USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_number_trgm      ON orders   USING gin (number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS orders_email_trgm       ON orders   USING gin (email  gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS orders_email_trgm;
DROP INDEX IF EXISTS orders_number_trgm;
DROP INDEX IF EXISTS customers_name_trgm;
DROP INDEX IF EXISTS customers_email_trgm;
DROP INDEX IF EXISTS products_handle_trgm;
DROP INDEX IF EXISTS products_title_trgm;
-- the extension stays; dropping it would invalidate any other index that uses it.
-- +goose StatementEnd
