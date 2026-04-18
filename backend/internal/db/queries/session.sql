-- name: CreateSession :exec
INSERT INTO sessions (id, user_id, user_type, expires_at, ip, user_agent)
VALUES ($1, $2, $3, $4, $5, $6);

-- name: GetSession :one
SELECT id, user_id, user_type, expires_at, created_at, last_seen_at, ip, user_agent
FROM sessions
WHERE id = $1 AND expires_at > now();

-- name: TouchSession :exec
UPDATE sessions
SET last_seen_at = now()
WHERE id = $1;

-- name: DeleteSession :exec
DELETE FROM sessions
WHERE id = $1;

-- name: DeleteSessionsByUser :exec
DELETE FROM sessions
WHERE user_id = $1 AND user_type = $2;

-- name: DeleteExpiredSessions :exec
DELETE FROM sessions
WHERE expires_at < now();
