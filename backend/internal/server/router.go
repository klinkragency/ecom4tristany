package server

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/3mg/shop/backend/internal/admin"
	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/customer"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Deps struct {
	Cfg      *config.Config
	Log      *slog.Logger
	DB       *pgxpool.Pool
	Sessions *session.Store
}

func NewRouter(d Deps) http.Handler {
	r := chi.NewRouter()

	r.Use(RequestID)
	r.Use(Logger(d.Log))
	r.Use(Recover(d.Log))
	r.Use(SecurityHeaders)
	r.Use(CORS(d.Cfg.CORSOrigins))
	r.Use(IPRateLimit(d.Cfg.RateLimitRPS))

	r.Get("/api/health", healthHandler(d.DB))
	r.Get("/api/csrf", csrfHandler(d.Cfg))

	// Admin
	adminH := admin.NewHandler(d.DB, d.Sessions)
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(auth.CSRF())
		r.Post("/auth/login", adminH.Login)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireAdmin(d.Sessions))
			r.Post("/auth/logout", adminH.Logout)
			r.Get("/me", adminH.Me)
		})
	})

	// Customer
	custH := customer.NewHandler(d.DB, d.Sessions)
	r.Route("/api/customer", func(r chi.Router) {
		r.Use(auth.CSRF())
		r.Post("/auth/register", custH.Register)
		r.Post("/auth/login", custH.Login)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireCustomer(d.Sessions))
			r.Post("/auth/logout", custH.Logout)
			r.Get("/me", custH.Me)
		})
	})

	return r
}

func healthHandler(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dbStatus := "up"
		ctx, cancel := context.WithTimeout(r.Context(), 500_000_000) // 500ms
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			dbStatus = "down"
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok": dbStatus == "up",
			"db": dbStatus,
		})
	}
}

func csrfHandler(cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := auth.NewCSRFToken()
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "csrf_error", "could not generate token")
			return
		}
		auth.SetCSRFCookie(w, token, cfg.SessionCookieDomain, cfg.SessionCookieSecure)
		httpx.JSON(w, http.StatusOK, map[string]string{"csrfToken": token})
	}
}
