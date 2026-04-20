package cms

import (
	"context"
	"encoding/xml"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BlogHandler has access to shop config (needed for the RSS feed URL
// canonicalisation). The plain Handler stays cfg-less.
type BlogHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewBlogHandler(db *pgxpool.Pool, cfg *config.Config) *BlogHandler {
	return &BlogHandler{db: db, cfg: cfg}
}

// ─── DTOs ───────────────────────────────────────────────────────────────

type BlogPost struct {
	ID                string     `json:"id"`
	Slug              string     `json:"slug"`
	Title             string     `json:"title"`
	Excerpt           string     `json:"excerpt"`
	ContentHTML       string     `json:"contentHtml"`
	AuthorName        string     `json:"authorName"`
	FeaturedImageURL  string     `json:"featuredImageUrl"`
	MetaDescription   string     `json:"metaDescription"`
	Status            string     `json:"status"`
	PublishedAt       *time.Time `json:"publishedAt,omitempty"`
	CreatedAt         time.Time  `json:"createdAt"`
	UpdatedAt         time.Time  `json:"updatedAt"`
	Tags              []string   `json:"tags"`
}

type BlogPostInput struct {
	Slug             string   `json:"slug"`
	Title            string   `json:"title"`
	Excerpt          string   `json:"excerpt"`
	ContentHTML      string   `json:"contentHtml"`
	AuthorName       string   `json:"authorName"`
	FeaturedImageURL string   `json:"featuredImageUrl"`
	MetaDescription  string   `json:"metaDescription"`
	Status           string   `json:"status"`
	Tags             []string `json:"tags"`
}

// ─── Admin ──────────────────────────────────────────────────────────────

func (h *BlogHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT id, slug, title, excerpt, content_html, author_name,
               featured_image_url, meta_description, status,
               published_at, created_at, updated_at
        FROM blog_posts ORDER BY COALESCE(published_at, updated_at) DESC
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []BlogPost{}
	for rows.Next() {
		p, err := scanBlogPost(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, *p)
	}
	for i := range items {
		items[i].Tags, _ = loadTags(r.Context(), h.db, items[i].ID)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *BlogHandler) AdminGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	row := h.db.QueryRow(r.Context(), `
        SELECT id, slug, title, excerpt, content_html, author_name,
               featured_image_url, meta_description, status,
               published_at, created_at, updated_at
        FROM blog_posts WHERE id = $1
    `, id)
	p, err := scanBlogPost(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "post not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	p.Tags, _ = loadTags(r.Context(), h.db, p.ID)
	httpx.JSON(w, http.StatusOK, p)
}

func (h *BlogHandler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	var req BlogPostInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateBlogInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	var publishedAt any
	if req.Status == "published" {
		publishedAt = time.Now().UTC()
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	err = tx.QueryRow(r.Context(), `
        INSERT INTO blog_posts (slug, title, excerpt, content_html, author_name,
                                featured_image_url, meta_description, status, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
    `, req.Slug, req.Title, req.Excerpt, req.ContentHTML, req.AuthorName,
		req.FeaturedImageURL, req.MetaDescription, req.Status, publishedAt).Scan(&id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "insert_error", err.Error())
		return
	}
	if err := writeTags(r.Context(), tx, id, req.Tags); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tags_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *BlogHandler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req BlogPostInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateBlogInput(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	res, err := tx.Exec(r.Context(), `
        UPDATE blog_posts SET
          slug = $1, title = $2, excerpt = $3, content_html = $4,
          author_name = $5, featured_image_url = $6, meta_description = $7,
          status = $8,
          published_at = CASE
            WHEN $8 = 'published' AND published_at IS NULL THEN now()
            ELSE published_at
          END,
          updated_at = now()
        WHERE id = $9
    `, req.Slug, req.Title, req.Excerpt, req.ContentHTML, req.AuthorName,
		req.FeaturedImageURL, req.MetaDescription, req.Status, id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM blog_post_tags WHERE post_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_tags", err.Error())
		return
	}
	if err := writeTags(r.Context(), tx, id, req.Tags); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tags_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *BlogHandler) AdminDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM blog_posts WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "post not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Storefront ─────────────────────────────────────────────────────────

func (h *BlogHandler) StorefrontList(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	tag := strings.TrimSpace(r.URL.Query().Get("tag"))
	args := []any{limit}
	where := "WHERE status = 'published'"
	if tag != "" {
		where += " AND EXISTS (SELECT 1 FROM blog_post_tags t WHERE t.post_id = blog_posts.id AND t.tag = $2)"
		args = append(args, tag)
	}
	rows, err := h.db.Query(r.Context(), `
        SELECT id, slug, title, excerpt, content_html, author_name,
               featured_image_url, meta_description, status,
               published_at, created_at, updated_at
        FROM blog_posts `+where+`
        ORDER BY published_at DESC
        LIMIT $1
    `, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []BlogPost{}
	for rows.Next() {
		p, err := scanBlogPost(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		// Storefront list hides the full HTML — saves bandwidth + forces
		// users through the detail page where we can track `post_view`.
		p.ContentHTML = ""
		items = append(items, *p)
	}
	for i := range items {
		items[i].Tags, _ = loadTags(r.Context(), h.db, items[i].ID)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *BlogHandler) StorefrontBySlug(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	row := h.db.QueryRow(r.Context(), `
        SELECT id, slug, title, excerpt, content_html, author_name,
               featured_image_url, meta_description, status,
               published_at, created_at, updated_at
        FROM blog_posts WHERE slug = $1 AND status = 'published'
    `, slug)
	p, err := scanBlogPost(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "post not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	p.Tags, _ = loadTags(r.Context(), h.db, p.ID)
	httpx.JSON(w, http.StatusOK, p)
}

// ─── RSS feed ───────────────────────────────────────────────────────────

type rssChannel struct {
	XMLName     xml.Name  `xml:"channel"`
	Title       string    `xml:"title"`
	Link        string    `xml:"link"`
	Description string    `xml:"description"`
	Language    string    `xml:"language"`
	Items       []rssItem `xml:"item"`
}

type rssItem struct {
	Title       string    `xml:"title"`
	Link        string    `xml:"link"`
	GUID        string    `xml:"guid"`
	PubDate     string    `xml:"pubDate"`
	Description string    `xml:"description"`
	Author      string    `xml:"author,omitempty"`
}

type rssFeed struct {
	XMLName xml.Name   `xml:"rss"`
	Version string     `xml:"version,attr"`
	Channel rssChannel `xml:"channel"`
}

func (h *BlogHandler) StorefrontFeed(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT slug, title, excerpt, author_name, published_at
        FROM blog_posts
        WHERE status = 'published' AND published_at IS NOT NULL
        ORDER BY published_at DESC LIMIT 50
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	base := strings.TrimRight(h.cfg.ShopPublicURL, "/")
	feed := rssFeed{
		Version: "2.0",
		Channel: rssChannel{
			Title:       h.cfg.ShopName + " — Blog",
			Link:        base + "/blog",
			Description: "Latest posts from " + h.cfg.ShopName,
			Language:    "fr-fr",
		},
	}
	for rows.Next() {
		var slug, title, excerpt, author string
		var pub *time.Time
		if err := rows.Scan(&slug, &title, &excerpt, &author, &pub); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		pubDate := ""
		if pub != nil {
			pubDate = pub.Format(time.RFC1123Z)
		}
		item := rssItem{
			Title:       title,
			Link:        base + "/blog/" + slug,
			GUID:        base + "/blog/" + slug,
			PubDate:     pubDate,
			Description: excerpt,
			Author:      author,
		}
		feed.Channel.Items = append(feed.Channel.Items, item)
	}

	w.Header().Set("Content-Type", "application/rss+xml; charset=utf-8")
	_, _ = w.Write([]byte(xml.Header))
	enc := xml.NewEncoder(w)
	enc.Indent("", "  ")
	_ = enc.Encode(feed)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func validateBlogInput(r *BlogPostInput) error {
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
	// Deduplicate + lowercase tags.
	seen := map[string]struct{}{}
	out := make([]string, 0, len(r.Tags))
	for _, t := range r.Tags {
		t = strings.ToLower(strings.TrimSpace(t))
		if t == "" {
			continue
		}
		if _, dup := seen[t]; dup {
			continue
		}
		seen[t] = struct{}{}
		out = append(out, t)
	}
	r.Tags = out
	return nil
}

func scanBlogPost(row pgx.Row) (*BlogPost, error) {
	var p BlogPost
	err := row.Scan(&p.ID, &p.Slug, &p.Title, &p.Excerpt, &p.ContentHTML,
		&p.AuthorName, &p.FeaturedImageURL, &p.MetaDescription, &p.Status,
		&p.PublishedAt, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	p.Tags = []string{}
	return &p, nil
}

func loadTags(ctx context.Context, db *pgxpool.Pool, postID string) ([]string, error) {
	rows, err := db.Query(ctx,
		`SELECT tag FROM blog_post_tags WHERE post_id = $1 ORDER BY tag`, postID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

func writeTags(ctx context.Context, tx pgx.Tx, postID string, tags []string) error {
	for _, t := range tags {
		if _, err := tx.Exec(ctx,
			`INSERT INTO blog_post_tags (post_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			postID, t); err != nil {
			return err
		}
	}
	return nil
}
