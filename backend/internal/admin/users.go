package admin

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
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/email"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const inviteTTL = 72 * time.Hour

// UsersHandler manages the admin_users table + invite lifecycle. It needs
// config for the shop URL (invite email links) and SMTP so it can send
// the invitation message. The plain Handler stays slim; invite plumbing
// lives here.
type UsersHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewUsersHandler(db *pgxpool.Pool, cfg *config.Config) *UsersHandler {
	return &UsersHandler{db: db, cfg: cfg}
}

// ─── DTOs ───────────────────────────────────────────────────────────────

type adminListItem struct {
	ID                 string     `json:"id"`
	Email              string     `json:"email"`
	Name               string     `json:"name"`
	Role               string     `json:"role"`
	MustChangePassword bool       `json:"mustChangePassword"`
	LastLoginAt        *time.Time `json:"lastLoginAt,omitempty"`
	InvitedAt          *time.Time `json:"invitedAt,omitempty"`
	CreatedAt          time.Time  `json:"createdAt"`
}

type inviteReq struct {
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

type roleReq struct {
	Role string `json:"role"`
}

// ─── Handlers ───────────────────────────────────────────────────────────

// List returns every admin user. Restricted to role=owner.
func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, email, name, role, must_change_password,
               last_login_at, invited_at, created_at
        FROM admin_users ORDER BY created_at ASC
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []adminListItem{}
	for rows.Next() {
		var it adminListItem
		if err := rows.Scan(&it.ID, &it.Email, &it.Name, &it.Role, &it.MustChangePassword,
			&it.LastLoginAt, &it.InvitedAt, &it.CreatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, it)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

// Invite creates an admin_users row with a random placeholder password and
// sends an invite email containing a one-time token. The invitee sets their
// real password via /auth/invite/confirm. Password hash is a random string
// the invitee can't ever match on login, so the account is unusable until
// accepted.
func (h *UsersHandler) Invite(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.SessionFromContext(r.Context())
	var req inviteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Name = strings.TrimSpace(req.Name)
	if req.Email == "" || req.Name == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_fields", "email and name required")
		return
	}
	if !isValidRole(req.Role) {
		httpx.Error(w, http.StatusBadRequest, "invalid_role", "role must be owner|admin|staff")
		return
	}
	// Placeholder password hash — argon2id format "$argon2id$…" prefixed
	// with "x" so the VerifyPassword parser refuses it. The invitee cannot
	// log in until they accept the invite and set a real password.
	placeholderHash, err := auth.HashPassword(randomSecret(32))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var adminID string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO admin_users (email, password_hash, name, role,
                                 must_change_password, invited_by, invited_at)
        VALUES ($1, $2, $3, $4, true, $5, now())
        RETURNING id
    `, req.Email, "x"+placeholderHash, req.Name, req.Role, sess.UserID).Scan(&adminID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			httpx.Error(w, http.StatusConflict, "email_taken", "an admin with this email already exists")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}

	// Generate an invite token, store the sha256 hash, send plaintext in email.
	secret := randomSecret(32)
	sum := sha256.Sum256([]byte(secret))
	tokenHash := hex.EncodeToString(sum[:])
	if _, err := tx.Exec(r.Context(), `
        INSERT INTO admin_invites (admin_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
    `, adminID, tokenHash, time.Now().Add(inviteTTL)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "invite_insert", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	// Send the email. Best-effort; we already committed.
	adminBase := strings.TrimRight(h.cfg.ShopPublicURL, "/")
	// The invite landing page lives on the admin app, not the storefront.
	// Use env override ADMIN_PUBLIC_URL when present — falls back to :3001.
	if env := adminBase; env != "" {
		adminBase = adminPublicURL(h.cfg)
	}
	inviteURL := fmt.Sprintf("%s/invite?token=%s", adminBase, secret)
	sender := email.New(h.cfg)
	go func() {
		_ = sender.Send(email.Message{
			To:      req.Email,
			Subject: "You've been invited to " + h.cfg.ShopName + " admin",
			HTML:    renderInviteHTML(h.cfg.ShopName, req.Name, inviteURL),
		})
	}()

	httpx.JSON(w, http.StatusCreated, map[string]any{
		"id":        adminID,
		"inviteUrl": inviteURL, // useful for admins if email fails
	})
}

// SetRole changes an admin's role. Owner-only.
func (h *UsersHandler) SetRole(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req roleReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if !isValidRole(req.Role) {
		httpx.Error(w, http.StatusBadRequest, "invalid_role", "role must be owner|admin|staff")
		return
	}
	// Prevent removing the last owner — leaves the shop un-administrable.
	var ownerCount int
	_ = h.db.QueryRow(r.Context(),
		`SELECT COUNT(*) FROM admin_users WHERE role = 'owner'`).Scan(&ownerCount)
	var currentRole string
	_ = h.db.QueryRow(r.Context(),
		`SELECT role FROM admin_users WHERE id = $1`, id).Scan(&currentRole)
	if currentRole == "owner" && req.Role != "owner" && ownerCount <= 1 {
		httpx.Error(w, http.StatusConflict, "last_owner",
			"cannot demote the last owner — promote another admin first")
		return
	}

	res, err := h.db.Exec(r.Context(),
		`UPDATE admin_users SET role = $1, updated_at = now() WHERE id = $2`,
		req.Role, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "admin not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Delete removes an admin user. Owner-only. Guards against deleting the
// last owner and against self-deletion (the admin should log out instead).
func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	sess, _ := auth.SessionFromContext(r.Context())
	if sess != nil && sess.UserID.Valid && uuidString(sess.UserID) == id {
		httpx.Error(w, http.StatusBadRequest, "self_delete",
			"you cannot delete your own account — ask another owner")
		return
	}
	var role string
	_ = h.db.QueryRow(r.Context(),
		`SELECT role FROM admin_users WHERE id = $1`, id).Scan(&role)
	if role == "owner" {
		var ownerCount int
		_ = h.db.QueryRow(r.Context(),
			`SELECT COUNT(*) FROM admin_users WHERE role = 'owner'`).Scan(&ownerCount)
		if ownerCount <= 1 {
			httpx.Error(w, http.StatusConflict, "last_owner",
				"cannot delete the last owner")
			return
		}
	}
	res, err := h.db.Exec(r.Context(), `DELETE FROM admin_users WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "admin not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ResendInvite generates a fresh invite token. Useful when the first email
// didn't land, or the original token has expired.
func (h *UsersHandler) ResendInvite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var email, name string
	var mustChange bool
	err := h.db.QueryRow(r.Context(),
		`SELECT email, name, must_change_password FROM admin_users WHERE id = $1`, id,
	).Scan(&email, &name, &mustChange)
	if err != nil {
		httpx.Error(w, http.StatusNotFound, "not_found", "admin not found")
		return
	}
	if !mustChange {
		httpx.Error(w, http.StatusConflict, "already_active",
			"this admin has already accepted the invite")
		return
	}
	secret := randomSecret(32)
	sum := sha256.Sum256([]byte(secret))
	tokenHash := hex.EncodeToString(sum[:])
	if _, err := h.db.Exec(r.Context(),
		`INSERT INTO admin_invites (admin_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		id, tokenHash, time.Now().Add(inviteTTL)); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "invite_insert", err.Error())
		return
	}
	inviteURL := fmt.Sprintf("%s/invite?token=%s", adminPublicURL(h.cfg), secret)
	sender := emailSender(h.cfg)
	go func() {
		_ = sender.Send(emailMessage(email, h.cfg.ShopName, name, inviteURL))
	}()
	httpx.JSON(w, http.StatusOK, map[string]any{"inviteUrl": inviteURL})
}

// ─── Invite acceptance (PUBLIC — no admin session yet) ──────────────────

type acceptInviteReq struct {
	Token    string `json:"token"`
	Password string `json:"password"`
}

// AcceptInvite validates the invite token + sets the invitee's password.
// Public endpoint (the invitee isn't logged in yet). On success, clears
// must_change_password and lets them sign in normally.
func (h *UsersHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) {
	var req acceptInviteReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.Token == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_token", "token required")
		return
	}
	if len(req.Password) < 8 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "password must be at least 8 characters")
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

	var inviteID, adminID string
	var expiresAt time.Time
	var usedAt *time.Time
	err = tx.QueryRow(r.Context(), `
        SELECT id, admin_id, expires_at, used_at
        FROM admin_invites WHERE token_hash = $1 FOR UPDATE
    `, tokenHash).Scan(&inviteID, &adminID, &expiresAt, &usedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusBadRequest, "invalid_token", "invalid or expired token")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if usedAt != nil {
		httpx.Error(w, http.StatusBadRequest, "already_used", "this invite has already been used")
		return
	}
	if time.Now().After(expiresAt) {
		httpx.Error(w, http.StatusBadRequest, "expired", "this invite has expired — ask for a new one")
		return
	}
	hashed, err := auth.HashPassword(req.Password)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(), `
        UPDATE admin_users SET password_hash = $1, must_change_password = false, updated_at = now()
        WHERE id = $2
    `, hashed, adminID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE admin_invites SET used_at = now() WHERE id = $1`, inviteID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "mark_used", err.Error())
		return
	}
	// Invalidate every other outstanding invite for the same admin.
	if _, err := tx.Exec(r.Context(), `
        UPDATE admin_invites SET used_at = now()
        WHERE admin_id = $1 AND used_at IS NULL AND id <> $2
    `, adminID, inviteID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "invalidate", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ChangePassword is for the logged-in admin to update their own password.
// Used by both the normal "change password" settings flow AND the forced
// first-login flow when must_change_password=true.
type changePasswordReq struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (h *UsersHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.SessionFromContext(r.Context())
	var req changePasswordReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if len(req.NewPassword) < 8 {
		httpx.Error(w, http.StatusBadRequest, "weak_password", "password must be at least 8 characters")
		return
	}
	var currentHash string
	if err := h.db.QueryRow(r.Context(),
		`SELECT password_hash FROM admin_users WHERE id = $1`, sess.UserID,
	).Scan(&currentHash); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if err := auth.VerifyPassword(req.CurrentPassword, currentHash); err != nil {
		httpx.Error(w, http.StatusUnauthorized, "bad_current", "current password does not match")
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "hash_error", err.Error())
		return
	}
	if _, err := h.db.Exec(r.Context(), `
        UPDATE admin_users SET password_hash = $1, must_change_password = false, updated_at = now()
        WHERE id = $2
    `, newHash, sess.UserID); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func isValidRole(r string) bool {
	return r == auth.RoleOwner || r == auth.RoleAdmin || r == auth.RoleStaff
}

func randomSecret(n int) string {
	buf := make([]byte, n)
	_, _ = rand.Read(buf)
	return base64.RawURLEncoding.EncodeToString(buf)
}

// adminPublicURL returns the URL where the admin app lives. We don't yet
// have a dedicated env var for it, so we infer from the storefront URL:
//   - strip "localhost:3000" → "localhost:3001" for dev
//   - in prod the admin should be explicitly configured (env var hook ready)
func adminPublicURL(cfg *config.Config) string {
	base := strings.TrimRight(cfg.ShopPublicURL, "/")
	if strings.HasSuffix(base, ":3000") {
		return strings.TrimSuffix(base, ":3000") + ":3001"
	}
	return base
}

func emailSender(cfg *config.Config) *email.Sender {
	return email.New(cfg)
}

func emailMessage(to, shopName, name, inviteURL string) email.Message {
	return email.Message{
		To:      to,
		Subject: "You've been invited to " + shopName + " admin",
		HTML:    renderInviteHTML(shopName, name, inviteURL),
	}
}

func renderInviteHTML(shopName, name, inviteURL string) string {
	esc := func(s string) string {
		return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(s)
	}
	return `<!doctype html><html><body style="margin:0;padding:0;font-family:ui-sans-serif,system-ui,sans-serif;background:#f6f6f7;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;">
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:24px;">
    <h1 style="margin:0 0 8px 0;font-size:22px;">You've been invited</h1>
    <p style="margin:0 0 16px 0;color:#4b5563;">Hi ` + esc(name) + `, you've been added as an admin on <b>` + esc(shopName) + `</b>. Click below to set your password and sign in. The link is valid for 72 hours.</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="` + esc(inviteURL) + `" style="display:inline-block;padding:12px 24px;border-radius:6px;background:#0a0a0a;color:#fff;text-decoration:none;font-weight:500;">Accept invite</a>
    </p>
    <p style="font-size:12px;color:#6b7280;">Or copy this URL into your browser:<br><span style="word-break:break-all;">` + esc(inviteURL) + `</span></p>
  </div>
  <p style="text-align:center;color:#9ca3af;font-size:12px;margin-top:16px;">© ` + esc(shopName) + `</p>
</div>
</body></html>`
}

// Silence unused-import when tests strip dependencies.
var _ = pgtype.UUID{}
