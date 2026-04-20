// Package cms owns the storefront content subsystems: static pages,
// navigation menus, and the blog. All three share the same rich-text
// HTML already produced by the Phase 2 product editor, so no new editor
// plumbing is needed — the admin UI re-uses those components.
//
// Route layout:
//
//	Admin   /api/admin/content/pages   (CRUD)
//	Admin   /api/admin/content/menus   (CRUD + items)
//	Admin   /api/admin/content/blog    (CRUD)
//	Public  /api/storefront/pages/{slug}
//	Public  /api/storefront/menus/{handle}
//	Public  /api/storefront/blog        (list)
//	Public  /api/storefront/blog/{slug} (detail)
//	Public  /api/storefront/blog/feed.xml
//
// The public reads never return drafts.
package cms

import (
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	db *pgxpool.Pool
}

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── DTOs ───────────────────────────────────────────────────────────────

type Page struct {
	ID              string     `json:"id"`
	Slug            string     `json:"slug"`
	Title           string     `json:"title"`
	ContentHTML     string     `json:"contentHtml"`
	Excerpt         string     `json:"excerpt"`
	MetaDescription string     `json:"metaDescription"`
	Status          string     `json:"status"`
	PublishedAt     *time.Time `json:"publishedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type PageInput struct {
	Slug            string `json:"slug"`
	Title           string `json:"title"`
	ContentHTML     string `json:"contentHtml"`
	Excerpt         string `json:"excerpt"`
	MetaDescription string `json:"metaDescription"`
	Status          string `json:"status"` // draft | published
}

// ─── Admin CRUD ─────────────────────────────────────────────────────────

func (h *Handler) AdminListPages(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, slug, title, content_html, excerpt, meta_description,
               status, published_at, created_at, updated_at
        FROM pages ORDER BY updated_at DESC
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []Page{}
	for rows.Next() {
		p, err := scanPage(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, *p)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminGetPage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row := h.db.QueryRow(r.Context(), `
        SELECT id, slug, title, content_html, excerpt, meta_description,
               status, published_at, created_at, updated_at
        FROM pages WHERE id = $1
    `, id)
	p, err := scanPage(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "page not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

func (h *Handler) AdminCreatePage(w http.ResponseWriter, r *http.Request) {
	var req PageInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validatePageInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	var publishedAt any
	if req.Status == "published" {
		publishedAt = time.Now().UTC()
	}

	var id string
	err := h.db.QueryRow(r.Context(), `
        INSERT INTO pages (slug, title, content_html, excerpt, meta_description, status, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
    `, req.Slug, req.Title, req.ContentHTML, req.Excerpt, req.MetaDescription,
		req.Status, publishedAt).Scan(&id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *Handler) AdminUpdatePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req PageInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validatePageInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	// If transitioning to 'published' and no publish time set, stamp one.
	res, err := h.db.Exec(r.Context(), `
        UPDATE pages SET
          slug = $1, title = $2, content_html = $3, excerpt = $4,
          meta_description = $5, status = $6,
          published_at = CASE
            WHEN $6 = 'published' AND published_at IS NULL THEN now()
            WHEN $6 = 'draft' THEN published_at  -- keep first-publish record
            ELSE published_at
          END,
          updated_at = now()
        WHERE id = $7
    `, req.Slug, req.Title, req.ContentHTML, req.Excerpt, req.MetaDescription,
		req.Status, id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "page not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AdminDeletePage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM pages WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "page not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Storefront (published only) ────────────────────────────────────────

func (h *Handler) StorefrontPageBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.db.QueryRow(r.Context(), `
        SELECT id, slug, title, content_html, excerpt, meta_description,
               status, published_at, created_at, updated_at
        FROM pages WHERE slug = $1 AND status = 'published'
    `, slug)
	p, err := scanPage(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "page not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, p)
}

// ─── Helpers ────────────────────────────────────────────────────────────

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

func validatePageInput(r *PageInput) error {
	r.Slug = strings.ToLower(strings.TrimSpace(r.Slug))
	r.Title = strings.TrimSpace(r.Title)
	if r.Title == "" {
		return errors.New("title required")
	}
	if !slugRe.MatchString(r.Slug) {
		return errors.New("slug must be lowercase letters/numbers/dashes (1-80 chars)")
	}
	switch r.Status {
	case "draft", "published":
	default:
		r.Status = "draft"
	}
	return nil
}

func scanPage(row pgx.Row) (*Page, error) {
	var p Page
	err := row.Scan(&p.ID, &p.Slug, &p.Title, &p.ContentHTML, &p.Excerpt,
		&p.MetaDescription, &p.Status, &p.PublishedAt, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func conflictOr500(err error) int {
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}
