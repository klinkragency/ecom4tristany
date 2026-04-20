package admin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db       *pgxpool.Pool
	sessions *session.Store
}

func NewHandler(db *pgxpool.Pool, sessions *session.Store) *Handler {
	return &Handler{db: db, sessions: sessions}
}

type LoginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type AdminDTO struct {
	ID                 string `json:"id"`
	Email              string `json:"email"`
	Name               string `json:"name"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"mustChangePassword,omitempty"`
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || req.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_fields", "email and password required")
		return
	}

	var (
		id                 pgtype.UUID
		hash               string
		name               string
		role               string
		mustChangePassword bool
	)
	err := h.db.QueryRow(r.Context(),
		`SELECT id, password_hash, name, role, must_change_password FROM admin_users WHERE email = $1`,
		req.Email,
	).Scan(&id, &hash, &name, &role, &mustChangePassword)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusUnauthorized, "invalid_credentials", "invalid credentials")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", "login failed")
		return
	}
	if err := auth.VerifyPassword(req.Password, hash); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "invalid_credentials", "invalid credentials")
		return
	}

	token, _, err := h.sessions.Create(r.Context(), id, session.TypeAdmin, clientIP(r), r.UserAgent())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session_error", "could not start session")
		return
	}
	h.sessions.SetCookie(w, session.TypeAdmin, token)
	// Best-effort: update last_login_at. Fire and forget to avoid coupling
	// login latency to an extra UPDATE.
	go func(id pgtype.UUID) {
		_, _ = h.db.Exec(r.Context(),
			`UPDATE admin_users SET last_login_at = now() WHERE id = $1`, id)
	}(id)

	httpx.JSON(w, http.StatusOK, AdminDTO{
		ID:                 uuidString(id),
		Email:              req.Email,
		Name:               name,
		Role:               role,
		MustChangePassword: mustChangePassword,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if token, ok := session.CookieFromRequest(r, session.TypeAdmin); ok {
		_ = h.sessions.Delete(r.Context(), token)
	}
	h.sessions.ClearCookie(w, session.TypeAdmin)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var (
		email              string
		name               string
		role               string
		mustChangePassword bool
	)
	err := h.db.QueryRow(r.Context(),
		`SELECT email, name, role, must_change_password FROM admin_users WHERE id = $1`,
		sess.UserID,
	).Scan(&email, &name, &role, &mustChangePassword)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "admin not found")
		return
	}
	httpx.JSON(w, http.StatusOK, AdminDTO{
		ID:                 uuidString(sess.UserID),
		Email:              email,
		Name:               name,
		Role:               role,
		MustChangePassword: mustChangePassword,
	})
}

func clientIP(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-For"); xf != "" {
		return xf
	}
	host := r.RemoteAddr
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == ':' {
			return host[:i]
		}
	}
	return host
}

func uuidString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	const hex = "0123456789abcdef"
	out := make([]byte, 36)
	j := 0
	for i := 0; i < 16; i++ {
		if i == 4 || i == 6 || i == 8 || i == 10 {
			out[j] = '-'
			j++
		}
		out[j] = hex[b[i]>>4]
		out[j+1] = hex[b[i]&0x0f]
		j += 2
	}
	return string(out)
}
