package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5/pgxpool"
)

// AuditMiddleware records every admin-originated mutating request (POST,
// PUT, PATCH, DELETE) into admin_audit_log. GETs are skipped — they're
// not state-changing and would swamp the table with noise.
//
// Implementation notes:
//   - We snapshot the request body before the handler runs (once it's
//     consumed, it's gone). Body is redacted of known-sensitive keys.
//   - The write is fire-and-forget after the response so audit failures
//     never impact user-visible behaviour.
//   - Resource type/id are parsed from the URL path with a lightweight
//     regex — good enough for our REST-style routes.
func AuditMiddleware(db *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			m := strings.ToUpper(r.Method)
			if m != "POST" && m != "PUT" && m != "PATCH" && m != "DELETE" {
				next.ServeHTTP(w, r)
				return
			}

			// Capture + restore body.
			var payloadRaw []byte
			if r.Body != nil {
				payloadRaw, _ = io.ReadAll(io.LimitReader(r.Body, 1<<16)) // 64KiB cap
				r.Body = io.NopCloser(bytes.NewReader(payloadRaw))
			}
			redacted := redactPayload(payloadRaw)

			rec := &statusRecorder{ResponseWriter: w, status: 200}
			start := time.Now()
			next.ServeHTTP(rec, r)
			_ = start

			// Snapshot everything we need off the request BEFORE the goroutine
			// starts — r.Context() is cancelled once the response is written,
			// so we use a detached context for the actual INSERT.
			sess, _ := auth.SessionFromContext(r.Context())
			path := r.URL.Path
			ip := clientIP(r)
			ua := r.UserAgent()
			status := rec.status

			go func() {
				defer func() { _ = recover() }()
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()

				var adminID any
				var adminEmail string
				if sess != nil && sess.UserID.Valid {
					adminID = sess.UserID
					_ = db.QueryRow(ctx,
						`SELECT email FROM admin_users WHERE id = $1`, sess.UserID,
					).Scan(&adminEmail)
				}
				resType, resID := parseResource(path)
				_, _ = db.Exec(ctx, `
                    INSERT INTO admin_audit_log
                      (admin_id, admin_email, method, path, status,
                       resource_type, resource_id, ip, user_agent, payload_redacted)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                `, adminID, adminEmail, m, path, status,
					resType, resID, ip, ua, redacted)
			}()
		})
	}
}

// resourceRe pulls the first collection segment + first UUID/numeric segment
// out of the URL, e.g. "/api/admin/products/abc-123/variants" → ("products", "abc-123").
var resourceRe = regexp.MustCompile(`/api/admin/([a-z-]+)(?:/([a-f0-9-]+|\d+))?`)

func parseResource(p string) (resType, resID string) {
	m := resourceRe.FindStringSubmatch(p)
	if m == nil {
		return "", ""
	}
	return m[1], m[2]
}

// statusRecorder tracks the HTTP status the handler wrote so we can log it.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// redactPayload strips keys that commonly carry secrets before storing.
// We parse as JSON when possible; on failure we store {}.
func redactPayload(raw []byte) []byte {
	if len(raw) == 0 {
		return []byte(`{}`)
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return []byte(`{}`)
	}
	redactDeep(parsed)
	out, err := json.Marshal(parsed)
	if err != nil {
		return []byte(`{}`)
	}
	return out
}

var sensitiveKeys = map[string]bool{
	"password":         true,
	"newPassword":      true,
	"currentPassword":  true,
	"token":            true,
	"secret":           true,
	"stripeSecretKey":  true,
	"apiKey":           true,
}

func redactDeep(v any) {
	switch x := v.(type) {
	case map[string]any:
		for k, vv := range x {
			if sensitiveKeys[k] {
				x[k] = "[REDACTED]"
				continue
			}
			redactDeep(vv)
		}
	case []any:
		for i := range x {
			redactDeep(x[i])
		}
	}
}

// ─── Viewer ─────────────────────────────────────────────────────────────

type auditRow struct {
	ID              string          `json:"id"`
	AdminID         *string         `json:"adminId,omitempty"`
	AdminEmail      string          `json:"adminEmail"`
	Method          string          `json:"method"`
	Path            string          `json:"path"`
	Status          int             `json:"status"`
	ResourceType    string          `json:"resourceType"`
	ResourceID      string          `json:"resourceId"`
	IP              string          `json:"ip"`
	UserAgent       string          `json:"userAgent"`
	PayloadRedacted json.RawMessage `json:"payload"`
	CreatedAt       time.Time       `json:"createdAt"`
}

// AuditList returns the most recent audit entries, optionally filtered by
// admin id or resource type.
func (h *UsersHandler) AuditList(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1=1"}
	args := []any{}
	next := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }
	if adminID := strings.TrimSpace(r.URL.Query().Get("adminId")); adminID != "" {
		where = append(where, "admin_id = "+next(adminID))
	}
	if resType := strings.TrimSpace(r.URL.Query().Get("resourceType")); resType != "" {
		where = append(where, "resource_type = "+next(resType))
	}
	args = append(args, limit)
	sql := `
        SELECT id, admin_id, admin_email, method, path, status,
               resource_type, resource_id, ip, user_agent,
               payload_redacted, created_at
        FROM admin_audit_log
        WHERE ` + strings.Join(where, " AND ") + `
        ORDER BY created_at DESC
        LIMIT $` + strconv.Itoa(len(args))
	rows, err := h.db.Query(r.Context(), sql, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []auditRow{}
	for rows.Next() {
		var it auditRow
		var payload []byte
		if err := rows.Scan(&it.ID, &it.AdminID, &it.AdminEmail, &it.Method, &it.Path,
			&it.Status, &it.ResourceType, &it.ResourceID, &it.IP, &it.UserAgent,
			&payload, &it.CreatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		it.PayloadRedacted = payload
		items = append(items, it)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}
