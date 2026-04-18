-- name: GetCustomerByEmail :one
SELECT id, email, password_hash, first_name, last_name, email_verified_at, created_at, updated_at
FROM customers
WHERE email = $1;

-- name: GetCustomerByID :one
SELECT id, email, password_hash, first_name, last_name, email_verified_at, created_at, updated_at
FROM customers
WHERE id = $1;

-- name: CreateCustomer :one
INSERT INTO customers (email, password_hash, first_name, last_name)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, first_name, last_name, email_verified_at, created_at, updated_at;
