package metaobject

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Entry struct {
	ID          string                 `json:"id"`
	TypeID      string                 `json:"typeId"`
	TypeHandle  string                 `json:"typeHandle"`
	Handle      string                 `json:"handle"`
	Name        string                 `json:"name"`
	Fields      map[string]any         `json:"fields"`
	Status      string                 `json:"status"`
	PublishedAt *time.Time             `json:"publishedAt,omitempty"`
	Position    int                    `json:"position"`
	CreatedAt   time.Time              `json:"createdAt"`
	UpdatedAt   time.Time              `json:"updatedAt"`
}

type EntryInput struct {
	Handle   string                 `json:"handle"`
	Name     string                 `json:"name"`
	Fields   map[string]any         `json:"fields"`
	Status   string                 `json:"status"`
	Position int                    `json:"position"`
}

// ─── Admin: entries CRUD ────────────────────────────────────────────────

func (h *Handler) ListEntries(w http.ResponseWriter, r *http.Request) {
	typeID := chi.URLParam(r, "typeId")
	rows, err := h.db.Query(r.Context(), `
        SELECT e.id, e.type_id, t.handle, e.handle, e.name, e.fields,
               e.status, e.published_at, e.position, e.created_at, e.updated_at
        FROM metaobject_entries e
        JOIN metaobject_types t ON t.id = e.type_id
        WHERE e.type_id = $1
        ORDER BY e.position, e.updated_at DESC
    `, typeID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, *e)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) GetEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	e, err := loadEntry(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "entry not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, e)
}

func (h *Handler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	typeID := chi.URLParam(r, "typeId")
	var req EntryInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	// Load the type's schema so we can validate fields against it.
	defs, err := fetchFieldDefs(r.Context(), h.db, typeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "type_not_found", "type not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "defs_error", err.Error())
		return
	}
	if err := validateEntry(&req, defs); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	fieldsRaw, _ := json.Marshal(req.Fields)
	var publishedAt any
	if req.Status == "published" {
		publishedAt = time.Now().UTC()
	}

	var id string
	err = h.db.QueryRow(r.Context(), `
        INSERT INTO metaobject_entries (type_id, handle, name, fields, status, published_at, position)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, typeID, req.Handle, req.Name, fieldsRaw, req.Status, publishedAt, req.Position).Scan(&id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *Handler) UpdateEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req EntryInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	// Find the entry's type so we can validate the new field values.
	var typeID string
	err := h.db.QueryRow(r.Context(),
		`SELECT type_id FROM metaobject_entries WHERE id = $1`, id,
	).Scan(&typeID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "entry not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defs, err := fetchFieldDefs(r.Context(), h.db, typeID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "defs_error", err.Error())
		return
	}
	if err := validateEntry(&req, defs); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	fieldsRaw, _ := json.Marshal(req.Fields)

	res, err := h.db.Exec(r.Context(), `
        UPDATE metaobject_entries SET
          handle = $1, name = $2, fields = $3, status = $4, position = $5,
          published_at = CASE
            WHEN $4 = 'published' AND published_at IS NULL THEN now()
            ELSE published_at
          END,
          updated_at = now()
        WHERE id = $6
    `, req.Handle, req.Name, fieldsRaw, req.Status, req.Position, id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "entry not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM metaobject_entries WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "entry not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Storefront (public, published only) ────────────────────────────────

func (h *Handler) StorefrontList(w http.ResponseWriter, r *http.Request) {
	typeHandle := chi.URLParam(r, "typeHandle")

	// Fetch type metadata so the storefront can render fields using the
	// admin-defined schema (rich_text as HTML, color as swatch, etc.).
	var t MetaType
	var rawDefs []byte
	err := h.db.QueryRow(r.Context(), `
        SELECT id, handle, name, description, field_defs
        FROM metaobject_types WHERE handle = $1
    `, typeHandle).Scan(&t.ID, &t.Handle, &t.Name, &t.Description, &rawDefs)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "type_not_found", "type not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	_ = json.Unmarshal(rawDefs, &t.FieldDefs)
	if t.FieldDefs == nil {
		t.FieldDefs = []FieldDef{}
	}

	rows, err := h.db.Query(r.Context(), `
        SELECT e.id, e.type_id, t.handle, e.handle, e.name, e.fields,
               e.status, e.published_at, e.position, e.created_at, e.updated_at
        FROM metaobject_entries e
        JOIN metaobject_types t ON t.id = e.type_id
        WHERE t.handle = $1 AND e.status = 'published'
        ORDER BY e.position, e.published_at DESC
    `, typeHandle)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []Entry{}
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, *e)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items,
		"type": map[string]any{
			"handle":      t.Handle,
			"name":        t.Name,
			"description": t.Description,
			"fieldDefs":   t.FieldDefs,
		},
	})
}

func (h *Handler) StorefrontByHandle(w http.ResponseWriter, r *http.Request) {
	typeHandle := chi.URLParam(r, "typeHandle")
	entryHandle := chi.URLParam(r, "entryHandle")
	row := h.db.QueryRow(r.Context(), `
        SELECT e.id, e.type_id, t.handle, e.handle, e.name, e.fields,
               e.status, e.published_at, e.position, e.created_at, e.updated_at
        FROM metaobject_entries e
        JOIN metaobject_types t ON t.id = e.type_id
        WHERE t.handle = $1 AND e.handle = $2 AND e.status = 'published'
    `, typeHandle, entryHandle)
	e, err := scanEntry(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "entry not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, e)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func scanEntry(row pgx.Row) (*Entry, error) {
	var e Entry
	var raw []byte
	err := row.Scan(&e.ID, &e.TypeID, &e.TypeHandle, &e.Handle, &e.Name, &raw,
		&e.Status, &e.PublishedAt, &e.Position, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return nil, err
	}
	e.Fields = map[string]any{}
	_ = json.Unmarshal(raw, &e.Fields)
	return &e, nil
}

func loadEntry(ctx context.Context, db *pgxpool.Pool, id string) (*Entry, error) {
	row := db.QueryRow(ctx, `
        SELECT e.id, e.type_id, t.handle, e.handle, e.name, e.fields,
               e.status, e.published_at, e.position, e.created_at, e.updated_at
        FROM metaobject_entries e
        JOIN metaobject_types t ON t.id = e.type_id
        WHERE e.id = $1
    `, id)
	return scanEntry(row)
}

func fetchFieldDefs(ctx context.Context, db *pgxpool.Pool, typeID string) ([]FieldDef, error) {
	var raw []byte
	err := db.QueryRow(ctx,
		`SELECT field_defs FROM metaobject_types WHERE id = $1`, typeID,
	).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var defs []FieldDef
	if err := json.Unmarshal(raw, &defs); err != nil {
		return nil, err
	}
	return defs, nil
}

var entryHandleRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,79}$`)

// validateEntry enforces:
//   - handle + name present
//   - status is draft | published
//   - fields match the type's schema (required, type shape)
//   - unknown keys in `fields` are dropped silently so old values survive
//     a schema rename without blocking the save.
func validateEntry(r *EntryInput, defs []FieldDef) error {
	r.Handle = strings.ToLower(strings.TrimSpace(r.Handle))
	r.Name = strings.TrimSpace(r.Name)
	if !entryHandleRe.MatchString(r.Handle) {
		return errors.New("handle must be lowercase letters/digits/dashes (1-80 chars)")
	}
	if r.Name == "" {
		return errors.New("name required")
	}
	switch r.Status {
	case "draft", "published":
	default:
		r.Status = "draft"
	}
	if r.Fields == nil {
		r.Fields = map[string]any{}
	}
	clean := make(map[string]any, len(defs))
	for _, def := range defs {
		raw, present := r.Fields[def.Key]
		if !present || raw == nil || raw == "" {
			if def.Required {
				return fmt.Errorf("field %q is required", def.Key)
			}
			continue
		}
		val, err := coerceField(def, raw)
		if err != nil {
			return fmt.Errorf("field %q: %w", def.Key, err)
		}
		clean[def.Key] = val
	}
	r.Fields = clean
	return nil
}

// coerceField validates + normalises a single field value according to its
// type. We accept JSON-decoded values from the request (float64 for numbers,
// string for everything else) and either coerce them or reject with a
// human-readable error the admin form can show.
func coerceField(def FieldDef, raw any) (any, error) {
	switch def.Type {
	case FieldSingleLineText, FieldMultiLineText, FieldRichText:
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("expected text")
		}
		return s, nil
	case FieldNumber:
		switch v := raw.(type) {
		case float64:
			return v, nil
		case string:
			// Allow string-encoded numbers for clients that serialise big
			// ints as strings — rare but avoids a confusing error.
			return v, nil
		}
		return nil, errors.New("expected number")
	case FieldBoolean:
		if b, ok := raw.(bool); ok {
			return b, nil
		}
		return nil, errors.New("expected boolean")
	case FieldURL, FieldFile:
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("expected URL string")
		}
		if s != "" && !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") && !strings.HasPrefix(s, "/") {
			return nil, errors.New("URL must start with http(s):// or /")
		}
		return s, nil
	case FieldDate:
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("expected ISO 8601 date string")
		}
		if s == "" {
			return s, nil
		}
		// Accept either date-only or full RFC3339.
		if _, err := time.Parse("2006-01-02", s); err == nil {
			return s, nil
		}
		if _, err := time.Parse(time.RFC3339, s); err == nil {
			return s, nil
		}
		return nil, errors.New("expected ISO 8601 date")
	case FieldColor:
		s, ok := raw.(string)
		if !ok {
			return nil, errors.New("expected #RRGGBB string")
		}
		if !colorHexRe.MatchString(s) {
			return nil, errors.New("expected #RRGGBB or #RGB")
		}
		return strings.ToLower(s), nil
	}
	return raw, nil
}

var colorHexRe = regexp.MustCompile(`^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)
