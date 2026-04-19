package customer

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/email"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5"
)

const resetTTL = 1 * time.Hour

// ─── Request (send email) ───────────────────────────────────────────────

type ResetRequestReq struct {
	Email string `json:"email"`
}

// RequestPasswordReset generates a single-use token (stored as sha256 hash),
// emails the plaintext secret embedded in a URL, and returns 204 regardless
// of whether the email matched a customer — this prevents enumeration.
func (h *Handler) RequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req ResetRequestReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	em := strings.TrimSpace(strings.ToLower(req.Email))
	if em == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_email", "email required")
		return
	}

	var customerID, first, last string
	err := h.db.QueryRow(r.Context(),
		`SELECT id, first_name, last_name FROM customers WHERE email = $1`, em,
	).Scan(&customerID, &first, &last)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Silent success to prevent account enumeration.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	// Generate 32 random bytes, send URL-safe base64 to the customer, store sha256.
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "rand_error", err.Error())
		return
	}
	secret := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(secret))
	tokenHash := hex.EncodeToString(sum[:])

	_, err = h.db.Exec(r.Context(), `
        INSERT INTO customer_password_resets (customer_id, token_hash, expires_at, ip, user_agent)
        VALUES ($1, $2, $3, $4, $5)
    `, customerID, tokenHash, time.Now().Add(resetTTL),
		clientIPFromRequest(r), r.UserAgent())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	// Build the confirmation URL and queue an email. Best-effort; failures
	// must not leak whether the account exists.
	resetURL := fmt.Sprintf("%s/account/password-reset/confirm?token=%s",
		strings.TrimRight(h.cfg.ShopPublicURL, "/"), secret)

	sender := email.New(h.cfg)
	name := strings.TrimSpace(first + " " + last)
	if name == "" {
		name = em
	}
	go func() {
		_ = sender.Send(email.Message{
			To:      em,
			Subject: "Reset your password — " + h.cfg.ShopName,
			HTML:    renderPasswordResetHTML(h.cfg.ShopName, name, resetURL),
		})
	}()
	w.WriteHeader(http.StatusNoContent)
}

// ─── Confirm (verify + set new password) ────────────────────────────────

type ResetConfirmReq struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

func (h *Handler) ConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var req ResetConfirmReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if len(req.Password) < 8 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "password must be at least 8 characters")
		return
	}
	if req.Token == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_token", "token required")
		return
	}
	sum := sha256.Sum256([]byte(req.Token))
	tokenHash := hex.EncodeToString(sum[:])

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id, customerID string
	var expiresAt time.Time
	var usedAt *time.Time
	err = tx.QueryRow(r.Context(), `
        SELECT id, customer_id, expires_at, used_at
        FROM customer_password_resets
        WHERE token_hash = $1 FOR UPDATE
    `, tokenHash).Scan(&id, &customerID, &expiresAt, &usedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusBadRequest, "invalid_token", "invalid or expired token")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if usedAt != nil {
		httpx.Error(w, http.StatusBadRequest, "already_used", "this reset link has already been used")
		return
	}
	if time.Now().After(expiresAt) {
		httpx.Error(w, http.StatusBadRequest, "expired", "this reset link has expired")
		return
	}

	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE customers SET password_hash = $1, updated_at = now() WHERE id = $2`,
		hashed, customerID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE customer_password_resets SET used_at = now() WHERE id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "mark_used_error", err.Error())
		return
	}
	// Invalidate all other outstanding tokens for this customer.
	if _, err := tx.Exec(r.Context(), `
        UPDATE customer_password_resets SET used_at = now()
        WHERE customer_id = $1 AND used_at IS NULL AND id <> $2
    `, customerID, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "invalidate_error", err.Error())
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Email template ─────────────────────────────────────────────────────

func renderPasswordResetHTML(shopName, name, url string) string {
	esc := func(s string) string {
		return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
	}
	return `<!doctype html><html><body style="margin:0;padding:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f6f7;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 8px 0;font-size:22px;">Reset your password</h1>
    <p style="margin:0 0 16px 0;color:#4b5563;">Hi ` + esc(name) + `, click the button below to set a new password. The link is valid for one hour and can be used only once.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="` + esc(url) + `" style="display:inline-block;padding:12px 24px;border-radius:6px;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:500;">Set a new password</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Or copy this URL into your browser:<br><span style="word-break:break-all;">` + esc(url) + `</span></p>
    <p style="font-size:12px;color:#6b7280;margin-top:24px;">If you didn&rsquo;t request this, you can safely ignore this email — your password won&rsquo;t change.</p>
  </div>
  <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">© ` + esc(shopName) + `</p>
</div>
</body></html>`
}

// clientIPFromRequest mirrors the version in addresses.go; inlined here to keep
// the package self-contained.
func clientIPFromRequest(r *http.Request) string {
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
