package customer

import (
	"errors"
	"net/http"
	"strings"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/session"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db       *pgxpool.Pool
	sessions *session.Store
	cfg      *config.Config
}

func NewHandler(db *pgxpool.Pool, sessions *session.Store) *Handler {
	return &Handler{db: db, sessions: sessions}
}

// NewHandlerWithConfig is used on the storefront where password reset needs
// the shop URL + email sender configuration. The plain NewHandler stays to
// keep admin-side callers unchanged.
func NewHandlerWithConfig(db *pgxpool.Pool, sessions *session.Store, cfg *config.Config) *Handler {
	return &Handler{db: db, sessions: sessions, cfg: cfg}
}

type RegisterReq struct {
	Email     string `json:"email"`
	Password  string `json:"password"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
}

type LoginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type CustomerDTO struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.FirstName = strings.TrimSpace(req.FirstName)
	req.LastName = strings.TrimSpace(req.LastName)
	if req.Email == "" || req.Password == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_fields", "email and password required")
		return
	}
	if len(req.Password) < 8 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "password must be at least 8 characters")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", "could not hash password")
		return
	}

	var id pgtype.UUID
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO customers (email, password_hash, first_name, last_name)
        VALUES ($1, $2, $3, $4)
        RETURNING id
    `, req.Email, hash, req.FirstName, req.LastName).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			httpx.Error(w, http.StatusConflict, "email_taken", "email already registered")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", "could not create account")
		return
	}

	token, _, err := h.sessions.Create(r.Context(), id, session.TypeCustomer, clientIP(r), r.UserAgent())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session_error", "could not start session")
		return
	}
	h.sessions.SetCookie(w, session.TypeCustomer, token)

	httpx.JSON(w, http.StatusCreated, CustomerDTO{
		ID:        uuidString(id),
		Email:     req.Email,
		FirstName: req.FirstName,
		LastName:  req.LastName,
	})
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
		id        pgtype.UUID
		hash      string
		firstName string
		lastName  string
	)
	err := h.db.QueryRow(r.Context(),
		`SELECT id, password_hash, first_name, last_name FROM customers WHERE email = $1`,
		req.Email,
	).Scan(&id, &hash, &firstName, &lastName)
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

	token, _, err := h.sessions.Create(r.Context(), id, session.TypeCustomer, clientIP(r), r.UserAgent())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "session_error", "could not start session")
		return
	}
	h.sessions.SetCookie(w, session.TypeCustomer, token)

	httpx.JSON(w, http.StatusOK, CustomerDTO{
		ID:        uuidString(id),
		Email:     req.Email,
		FirstName: firstName,
		LastName:  lastName,
	})
}

func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if token, ok := session.CookieFromRequest(r, session.TypeCustomer); ok {
		_ = h.sessions.Delete(r.Context(), token)
	}
	h.sessions.ClearCookie(w, session.TypeCustomer)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	sess, ok := auth.SessionFromContext(r.Context())
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	var (
		email     string
		firstName string
		lastName  string
	)
	err := h.db.QueryRow(r.Context(),
		`SELECT email, first_name, last_name FROM customers WHERE id = $1`,
		sess.UserID,
	).Scan(&email, &firstName, &lastName)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "customer not found")
		return
	}
	httpx.JSON(w, http.StatusOK, CustomerDTO{
		ID:        uuidString(sess.UserID),
		Email:     email,
		FirstName: firstName,
		LastName:  lastName,
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
