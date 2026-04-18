-- name: GetAdminByEmail :one
SELECT id, email, password_hash, name, role, created_at, updated_at
FROM admin_users
WHERE email = $1;

-- name: GetAdminByID :one
SELECT id, email, password_hash, name, role, created_at, updated_at
FROM admin_users
WHERE id = $1;

-- name: CreateAdmin :one
INSERT INTO admin_users (email, password_hash, name, role)
VALUES ($1, $2, $3, $4)
RETURNING id, email, password_hash, name, role, created_at, updated_at;

-- name: CountAdmins :one
SELECT COUNT(*) FROM admin_users;
