package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserType string

const (
	TypeAdmin    UserType = "admin"
	TypeCustomer UserType = "customer"
)

const (
	AdminCookie    = "admin_sid"
	CustomerCookie = "cust_sid"
)

type Session struct {
	ID         string
	UserID     pgtype.UUID
	UserType   UserType
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
	IP         string
	UserAgent  string
}

type Store struct {
	db           *pgxpool.Pool
	ttl          time.Duration
	cookieDomain string
	cookieSecure bool
}

func NewStore(db *pgxpool.Pool, ttl time.Duration, cookieDomain string, cookieSecure bool) *Store {
	return &Store{db: db, ttl: ttl, cookieDomain: cookieDomain, cookieSecure: cookieSecure}
}

func newToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func (s *Store) Create(ctx context.Context, userID pgtype.UUID, userType UserType, ip, ua string) (string, *Session, error) {
	token, err := newToken()
	if err != nil {
		return "", nil, err
	}
	exp := time.Now().Add(s.ttl)
	_, err = s.db.Exec(ctx, `
        INSERT INTO sessions (id, user_id, user_type, expires_at, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5, $6)
    `, token, userID, string(userType), exp, ip, ua)
	if err != nil {
		return "", nil, err
	}
	return token, &Session{
		ID:        token,
		UserID:    userID,
		UserType:  userType,
		ExpiresAt: exp,
		IP:        ip,
		UserAgent: ua,
	}, nil
}

var ErrNotFound = errors.New("session not found or expired")

func (s *Store) Get(ctx context.Context, token string) (*Session, error) {
	row := s.db.QueryRow(ctx, `
        SELECT id, user_id, user_type, expires_at, created_at, last_seen_at, ip, user_agent
        FROM sessions
        WHERE id = $1 AND expires_at > now()
    `, token)
	var sess Session
	var ut string
	if err := row.Scan(&sess.ID, &sess.UserID, &ut, &sess.ExpiresAt, &sess.CreatedAt, &sess.LastSeenAt, &sess.IP, &sess.UserAgent); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	sess.UserType = UserType(ut)
	return &sess, nil
}

func (s *Store) Touch(ctx context.Context, token string) error {
	_, err := s.db.Exec(ctx, `UPDATE sessions SET last_seen_at = now() WHERE id = $1`, token)
	return err
}

func (s *Store) Delete(ctx context.Context, token string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, token)
	return err
}

func (s *Store) DeleteExpired(ctx context.Context) error {
	_, err := s.db.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`)
	return err
}

// SetCookie writes the session cookie for the given user type.
func (s *Store) SetCookie(w http.ResponseWriter, userType UserType, token string) {
	name := cookieName(userType)
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    token,
		Path:     "/",
		Domain:   s.cookieDomain,
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(s.ttl.Seconds()),
	})
}

func (s *Store) ClearCookie(w http.ResponseWriter, userType UserType) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName(userType),
		Value:    "",
		Path:     "/",
		Domain:   s.cookieDomain,
		HttpOnly: true,
		Secure:   s.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

func CookieFromRequest(r *http.Request, userType UserType) (string, bool) {
	c, err := r.Cookie(cookieName(userType))
	if err != nil {
		return "", false
	}
	return c.Value, c.Value != ""
}

func cookieName(ut UserType) string {
	switch ut {
	case TypeAdmin:
		return AdminCookie
	case TypeCustomer:
		return CustomerCookie
	}
	return "sid"
}
