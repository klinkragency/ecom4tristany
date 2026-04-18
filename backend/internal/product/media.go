package product

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ─── Presign ─────────────────────────────────────────────────────────────

type PresignReq struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
}

type PresignResp struct {
	UploadURL string `json:"uploadUrl"`
	ObjectKey string `json:"objectKey"`
	PublicURL string `json:"publicUrl"`
	ExpiresIn int    `json:"expiresInSeconds"`
}

var allowedImageTypes = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
	"image/avif": ".avif",
}

func (h *Handler) PresignMediaUpload(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req PresignReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	ct := strings.ToLower(strings.TrimSpace(req.ContentType))
	ext, ok := allowedImageTypes[ct]
	if !ok {
		httpx.Error(w, http.StatusBadRequest, "unsupported_type",
			"supported content types: image/png, image/jpeg, image/webp, image/gif, image/avif")
		return
	}
	// Prefer the filename's extension if sensible; otherwise use the content-type-derived one.
	if e := strings.ToLower(path.Ext(req.Filename)); e != "" {
		switch e {
		case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif":
			ext = e
		}
	}

	// Verify the product exists before issuing a signed URL.
	var exists bool
	if err := h.db.QueryRow(r.Context(),
		`SELECT EXISTS (SELECT 1 FROM products WHERE id = $1)`, pid).Scan(&exists); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if !exists {
		httpx.Error(w, http.StatusNotFound, "not_found", "product not found")
		return
	}

	randSeg := randHex(8)
	key := "products/" + pid + "/" + randSeg + ext
	ttl := 10 * time.Minute

	url, err := h.storage.PresignPut(r.Context(), key, ct, ttl)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "presign_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, PresignResp{
		UploadURL: url,
		ObjectKey: key,
		PublicURL: h.storage.PublicURL(key),
		ExpiresIn: int(ttl.Seconds()),
	})
}

// ─── Attach media to product ─────────────────────────────────────────────

type AttachMediaReq struct {
	ObjectKey string  `json:"objectKey"`
	Alt       string  `json:"alt"`
	Width     *int    `json:"width,omitempty"`
	Height    *int    `json:"height,omitempty"`
	Bytes     *int    `json:"bytes,omitempty"`
	Mime      string  `json:"mime"`
	VariantID *string `json:"variantId,omitempty"`
}

func (h *Handler) AttachMedia(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req AttachMediaReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if req.ObjectKey == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_key", "objectKey required")
		return
	}
	// Verify upload completed by HEADing the object.
	exists, err := h.storage.HeadObject(r.Context(), req.ObjectKey)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "head_error", err.Error())
		return
	}
	if !exists {
		httpx.Error(w, http.StatusBadRequest, "not_uploaded",
			"no object at that key — did the browser PUT succeed?")
		return
	}

	if req.Mime == "" {
		if t := mime.TypeByExtension(path.Ext(req.ObjectKey)); t != "" {
			req.Mime = t
		}
	}

	var pos int
	if err := h.db.QueryRow(r.Context(),
		`SELECT COALESCE(MAX(position)+1, 0) FROM product_media WHERE product_id = $1`, pid,
	).Scan(&pos); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pos_error", err.Error())
		return
	}

	publicURL := h.storage.PublicURL(req.ObjectKey)
	var id string
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO product_media (product_id, variant_id, kind, object_key, url, alt, width, height, bytes, mime, position)
        VALUES ($1, $2, 'image', $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
    `, pid, req.VariantID, req.ObjectKey, publicURL, req.Alt, req.Width, req.Height, req.Bytes, req.Mime, pos).Scan(&id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, Media{
		ID:        id,
		ProductID: pid,
		VariantID: req.VariantID,
		Kind:      "image",
		ObjectKey: req.ObjectKey,
		URL:       publicURL,
		Alt:       req.Alt,
		Width:     req.Width,
		Height:    req.Height,
		Bytes:     req.Bytes,
		Mime:      req.Mime,
		Position:  pos,
	})
}

// ─── Update / Reorder / Delete ───────────────────────────────────────────

type UpdateMediaReq struct {
	Alt      *string `json:"alt,omitempty"`
	Position *int    `json:"position,omitempty"`
}

func (h *Handler) UpdateMedia(w http.ResponseWriter, r *http.Request) {
	mid := chi.URLParam(r, "mediaId")
	var req UpdateMediaReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	sets := []string{}
	args := []any{mid}
	add := func(col string, v any) {
		args = append(args, v)
		sets = append(sets, col+" = $"+itoa(len(args)))
	}
	if req.Alt != nil {
		add("alt", *req.Alt)
	}
	if req.Position != nil {
		add("position", *req.Position)
	}
	if len(sets) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	res, err := h.db.Exec(r.Context(),
		"UPDATE product_media SET "+strings.Join(sets, ", ")+" WHERE id = $1", args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "media not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type ReorderMediaReq struct {
	OrderedIDs []string `json:"orderedIds"`
}

func (h *Handler) ReorderMedia(w http.ResponseWriter, r *http.Request) {
	pid := chi.URLParam(r, "id")
	var req ReorderMediaReq
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())
	for i, id := range req.OrderedIDs {
		if _, err := tx.Exec(r.Context(),
			`UPDATE product_media SET position = $1 WHERE id = $2 AND product_id = $3`,
			i, id, pid); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "reorder_error", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteMedia(w http.ResponseWriter, r *http.Request) {
	mid := chi.URLParam(r, "mediaId")
	var key string
	err := h.db.QueryRow(r.Context(),
		`DELETE FROM product_media WHERE id = $1 RETURNING object_key`, mid).Scan(&key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "media not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	// Best-effort object cleanup; don't fail the request if the object is already gone.
	_ = h.storage.Delete(r.Context(), key)
	w.WriteHeader(http.StatusNoContent)
}

// ─── helpers ─────────────────────────────────────────────────────────────

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
