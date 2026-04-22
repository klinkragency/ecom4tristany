// Package metaobject implements Shopify-style user-defined content types.
//
// A "type" is a schema (list of FieldDef). An "entry" is an instance of a
// type — a row of jsonb validated against the type's FieldDefs. The admin
// creates types once ("Size Chart", "FAQ Item", "Location") then fills in
// entries as often as needed.
//
// Why jsonb instead of normalised columns? The dominant access pattern is
// "give me all entries of type X" followed by "render the fields the
// admin defined". A normalised table would need joins per field type and
// would force a schema migration each time the admin adds a field —
// unacceptable for user-configurable content.
package metaobject

import (
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

type Handler struct{ db *pgxpool.Pool }

func NewHandler(db *pgxpool.Pool) *Handler { return &Handler{db: db} }

// ─── Schema + DTOs ──────────────────────────────────────────────────────

// FieldType restricts what `kind` the admin can set on a field definition.
// The set is deliberately small — enough to cover ~95% of what shops put
// in metaobjects (text, rich text, numbers, URLs, files, dates, colors).
type FieldType string

const (
	FieldSingleLineText FieldType = "single_line_text"
	FieldMultiLineText  FieldType = "multi_line_text"
	FieldRichText       FieldType = "rich_text"
	FieldNumber         FieldType = "number"
	FieldBoolean        FieldType = "boolean"
	FieldURL            FieldType = "url"
	FieldFile           FieldType = "file" // stores a URL string — full file picker is a later phase
	FieldDate           FieldType = "date"
	FieldColor          FieldType = "color" // stored as hex "#RRGGBB"
)

var validFieldTypes = map[FieldType]bool{
	FieldSingleLineText: true, FieldMultiLineText: true, FieldRichText: true,
	FieldNumber: true, FieldBoolean: true, FieldURL: true, FieldFile: true,
	FieldDate: true, FieldColor: true,
}

// FieldDef is one column in a metaobject type's schema.
type FieldDef struct {
	Key      string    `json:"key"`      // machine name; snake_case, unique per type
	Name     string    `json:"name"`     // human label
	Type     FieldType `json:"type"`
	Required bool      `json:"required"`
	Help     string    `json:"help,omitempty"` // shown as a tooltip in the admin form
}

type MetaType struct {
	ID          string     `json:"id"`
	Handle      string     `json:"handle"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	FieldDefs   []FieldDef `json:"fieldDefs"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
	// EntryCount is filled on list only. Cheap COUNT(*) per type — a shop
	// rarely has more than a few hundred types.
	EntryCount int `json:"entryCount,omitempty"`
}

type MetaTypeInput struct {
	Handle      string     `json:"handle"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	FieldDefs   []FieldDef `json:"fieldDefs"`
}

// ─── Admin: types CRUD ──────────────────────────────────────────────────

func (h *Handler) ListTypes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT t.id, t.handle, t.name, t.description, t.field_defs,
               t.created_at, t.updated_at,
               (SELECT COUNT(*) FROM metaobject_entries e WHERE e.type_id = t.id)::int AS entry_count
        FROM metaobject_types t ORDER BY t.updated_at DESC
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []MetaType{}
	for rows.Next() {
		var t MetaType
		var raw []byte
		if err := rows.Scan(&t.ID, &t.Handle, &t.Name, &t.Description, &raw,
			&t.CreatedAt, &t.UpdatedAt, &t.EntryCount); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		_ = json.Unmarshal(raw, &t.FieldDefs)
		if t.FieldDefs == nil {
			t.FieldDefs = []FieldDef{}
		}
		items = append(items, t)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) GetType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	t, err := loadType(r, h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "type not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, t)
}

func (h *Handler) CreateType(w http.ResponseWriter, r *http.Request) {
	var req MetaTypeInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateType(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	defs, _ := json.Marshal(req.FieldDefs)
	var id string
	err := h.db.QueryRow(r.Context(), `
        INSERT INTO metaobject_types (handle, name, description, field_defs)
        VALUES ($1, $2, $3, $4) RETURNING id
    `, req.Handle, req.Name, req.Description, defs).Scan(&id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "insert_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (h *Handler) UpdateType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req MetaTypeInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if err := validateType(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_input", err.Error())
		return
	}
	defs, _ := json.Marshal(req.FieldDefs)
	res, err := h.db.Exec(r.Context(), `
        UPDATE metaobject_types
        SET handle = $1, name = $2, description = $3, field_defs = $4, updated_at = now()
        WHERE id = $5
    `, req.Handle, req.Name, req.Description, defs, id)
	if err != nil {
		httpx.Error(w, conflictOr500(err), "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "type not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM metaobject_types WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "type not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Helpers ────────────────────────────────────────────────────────────

var handleRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)
var fieldKeyRe = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}$`)

func validateType(r *MetaTypeInput) error {
	r.Handle = strings.ToLower(strings.TrimSpace(r.Handle))
	r.Name = strings.TrimSpace(r.Name)
	if !handleRe.MatchString(r.Handle) {
		return errors.New("handle must be lowercase letters/digits/underscores (1-40 chars, starts with a letter)")
	}
	if r.Name == "" {
		return errors.New("name required")
	}
	if r.FieldDefs == nil {
		r.FieldDefs = []FieldDef{}
	}
	seen := map[string]struct{}{}
	for i := range r.FieldDefs {
		f := &r.FieldDefs[i]
		f.Key = strings.ToLower(strings.TrimSpace(f.Key))
		f.Name = strings.TrimSpace(f.Name)
		if !fieldKeyRe.MatchString(f.Key) {
			return fmt.Errorf("field[%d]: key must be snake_case (1-40 chars, starts with a letter)", i)
		}
		if f.Name == "" {
			return fmt.Errorf("field[%d]: name required", i)
		}
		if !validFieldTypes[f.Type] {
			return fmt.Errorf("field[%d]: unknown type %q", i, f.Type)
		}
		if _, dup := seen[f.Key]; dup {
			return fmt.Errorf("field[%d]: duplicate key %q", i, f.Key)
		}
		seen[f.Key] = struct{}{}
	}
	return nil
}

func conflictOr500(err error) int {
	if err != nil && strings.Contains(err.Error(), "duplicate key") {
		return http.StatusConflict
	}
	return http.StatusInternalServerError
}

// loadType fetches a single type with its field_defs unmarshalled.
func loadType(r *http.Request, db *pgxpool.Pool, id string) (*MetaType, error) {
	var t MetaType
	var raw []byte
	err := db.QueryRow(r.Context(), `
        SELECT id, handle, name, description, field_defs, created_at, updated_at
        FROM metaobject_types WHERE id = $1
    `, id).Scan(&t.ID, &t.Handle, &t.Name, &t.Description, &raw, &t.CreatedAt, &t.UpdatedAt)
	if err != nil {
		return nil, err
	}
	_ = json.Unmarshal(raw, &t.FieldDefs)
	if t.FieldDefs == nil {
		t.FieldDefs = []FieldDef{}
	}
	return &t, nil
}
