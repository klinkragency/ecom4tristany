// Package auth — role-based access control helpers.
//
// We model admin privilege as a short tiered list:
//
//   owner → full rights, including managing other admins + shop settings
//   admin → everything except admin-user management and settings
//   staff → read-only on sensitive resources; writes are limited to
//           day-to-day ops (mark fulfillments, update customer notes)
//
// A coarse role matrix (rather than fine-grained permissions) keeps the
// mental model small. Introduce a permissions table only once we actually
// need per-action overrides.
package auth

import (
	"net/http"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	RoleOwner = "owner"
	RoleAdmin = "admin"
	RoleStaff = "staff"
)

// RequireRole enforces that the authenticated admin has at least one of the
// listed roles. Must be layered AFTER RequireAdmin. The admin's role is
// resolved from the DB per request — this keeps the check authoritative
// even if the role was updated between login and the current call.
func RequireRole(db *pgxpool.Pool, roles ...string) func(http.Handler) http.Handler {
	allowed := map[string]bool{}
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sess, ok := SessionFromContext(r.Context())
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
				return
			}
			var role string
			err := db.QueryRow(r.Context(),
				`SELECT role FROM admin_users WHERE id = $1`, sess.UserID,
			).Scan(&role)
			if err != nil {
				httpx.Error(w, http.StatusInternalServerError, "role_lookup", err.Error())
				return
			}
			if !allowed[role] {
				httpx.Error(w, http.StatusForbidden, "forbidden",
					"this action requires a higher role")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AdminRole returns the current admin's role, or "" when not authenticated
// or on lookup error. Handy for UI-hint endpoints (e.g. the /me response).
func AdminRole(db *pgxpool.Pool, r *http.Request) string {
	sess, ok := SessionFromContext(r.Context())
	if !ok {
		return ""
	}
	var role string
	_ = db.QueryRow(r.Context(),
		`SELECT role FROM admin_users WHERE id = $1`, sess.UserID,
	).Scan(&role)
	return role
}
