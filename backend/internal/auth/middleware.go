package auth

import (
	"context"
	"net/http"

	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"
)

type ctxKey int

const (
	ctxSession ctxKey = iota
)

// RequireAdmin ensures an admin session is present; 401 otherwise.
func RequireAdmin(store *session.Store) func(http.Handler) http.Handler {
	return requireSession(store, session.TypeAdmin)
}

// RequireCustomer ensures a customer session is present; 401 otherwise.
func RequireCustomer(store *session.Store) func(http.Handler) http.Handler {
	return requireSession(store, session.TypeCustomer)
}

func requireSession(store *session.Store, userType session.UserType) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := session.CookieFromRequest(r, userType)
			if !ok {
				httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
				return
			}
			sess, err := store.Get(r.Context(), token)
			if err != nil || sess.UserType != userType {
				httpx.Error(w, http.StatusUnauthorized, "unauthorized", "session invalid")
				return
			}
			// fire-and-forget touch
			go func(id string) { _ = store.Touch(context.Background(), id) }(sess.ID)
			ctx := context.WithValue(r.Context(), ctxSession, sess)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// SessionFromContext returns the session if the request passed a Require* middleware.
func SessionFromContext(ctx context.Context) (*session.Session, bool) {
	s, ok := ctx.Value(ctxSession).(*session.Session)
	return s, ok
}

// CSRF verifies the double-submit cookie on mutating methods.
func CSRF() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.Method {
			case http.MethodGet, http.MethodHead, http.MethodOptions:
				next.ServeHTTP(w, r)
				return
			}
			if !VerifyCSRF(r) {
				httpx.Error(w, http.StatusForbidden, "csrf", "CSRF token missing or invalid")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
