package cms

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── DTOs ───────────────────────────────────────────────────────────────

type Menu struct {
	ID        string     `json:"id"`
	Handle    string     `json:"handle"`
	Name      string     `json:"name"`
	Items     []MenuItem `json:"items"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type MenuItem struct {
	ID            string     `json:"id"`
	MenuID        string     `json:"menuId"`
	ParentID      *string    `json:"parentId,omitempty"`
	Position      int        `json:"position"`
	Label         string     `json:"label"`
	LinkType      string     `json:"linkType"`
	Target        string     `json:"target"`
	OpenInNewTab  bool       `json:"openInNewTab"`
	Children      []MenuItem `json:"children,omitempty"`
}

type MenuInput struct {
	Name  string          `json:"name"`
	Items []MenuItemInput `json:"items"`
}

type MenuItemInput struct {
	// ClientID is an optional client-side stable identifier the admin UI
	// assigns to new items so parent_id references can be resolved
	// in-tx — e.g. "tmp-1". Ignored on save; server-generated UUIDs replace.
	ClientID       string          `json:"clientId,omitempty"`
	ParentClientID string          `json:"parentClientId,omitempty"`
	Label          string          `json:"label"`
	LinkType       string          `json:"linkType"`
	Target         string          `json:"target"`
	OpenInNewTab   bool            `json:"openInNewTab"`
	Children       []MenuItemInput `json:"children,omitempty"`
}

var validLinkTypes = map[string]bool{
	"url": true, "page": true, "collection": true, "product": true,
	"blog": true, "blog_post": true, "menu_header": true,
}

// ─── Admin ──────────────────────────────────────────────────────────────

func (h *Handler) AdminListMenus(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(),
		`SELECT id, handle, name, created_at, updated_at FROM menus ORDER BY handle`)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	items := []Menu{}
	for rows.Next() {
		var m Menu
		if err := rows.Scan(&m.ID, &m.Handle, &m.Name, &m.CreatedAt, &m.UpdatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		m.Items = []MenuItem{}
		items = append(items, m)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) AdminGetMenu(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := loadMenu(r.Context(), h.db, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "menu not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, m)
}

// AdminUpdateMenu replaces the entire items tree with what the client
// sends. Simpler (and a more accurate model of what the admin UI does —
// "save the whole menu") than surgical add/remove endpoints.
func (h *Handler) AdminUpdateMenu(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req MenuInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	res, err := tx.Exec(r.Context(),
		`UPDATE menus SET name = $1, updated_at = now() WHERE id = $2`, req.Name, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "menu not found")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM menu_items WHERE menu_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_error", err.Error())
		return
	}
	if err := writeMenuItems(r.Context(), tx, id, req.Items, ""); err != nil {
		httpx.Error(w, http.StatusBadRequest, "items_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}
	m, _ := loadMenu(r.Context(), h.db, id)
	httpx.JSON(w, http.StatusOK, m)
}

// ─── Storefront ─────────────────────────────────────────────────────────

func (h *Handler) StorefrontMenuByHandle(w http.ResponseWriter, r *http.Request) {
	handle := chi.URLParam(r, "handle")
	var id string
	err := h.db.QueryRow(r.Context(),
		`SELECT id FROM menus WHERE handle = $1`, handle).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Treat missing menus as empty rather than 404 — simplifies the
			// storefront layout (no "oops" rendering a header that happens
			// to have no menu configured yet).
			httpx.JSON(w, http.StatusOK, Menu{Handle: handle, Items: []MenuItem{}})
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	m, err := loadMenu(r.Context(), h.db, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, m)
}

// ─── Helpers ────────────────────────────────────────────────────────────

func loadMenu(ctx context.Context, db *pgxpool.Pool, id string) (*Menu, error) {
	var m Menu
	err := db.QueryRow(ctx, `
        SELECT id, handle, name, created_at, updated_at
        FROM menus WHERE id = $1
    `, id).Scan(&m.ID, &m.Handle, &m.Name, &m.CreatedAt, &m.UpdatedAt)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, `
        SELECT id, menu_id, parent_id, position, label, link_type, target, open_in_new_tab
        FROM menu_items WHERE menu_id = $1
        ORDER BY COALESCE(parent_id::text, ''), position
    `, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	all := []MenuItem{}
	for rows.Next() {
		var it MenuItem
		if err := rows.Scan(&it.ID, &it.MenuID, &it.ParentID, &it.Position,
			&it.Label, &it.LinkType, &it.Target, &it.OpenInNewTab); err != nil {
			return nil, err
		}
		it.Children = []MenuItem{}
		all = append(all, it)
	}
	// Nest children under parents. One pass — we only support one level of
	// nesting, so no recursion needed.
	byID := map[string]*MenuItem{}
	for i := range all {
		byID[all[i].ID] = &all[i]
	}
	m.Items = []MenuItem{}
	for i := range all {
		it := &all[i]
		if it.ParentID == nil {
			m.Items = append(m.Items, *it)
		}
	}
	// Attach children in a separate pass so parent pointers above are valid.
	for i := range all {
		it := all[i]
		if it.ParentID == nil {
			continue
		}
		parent := findTopLevel(m.Items, *it.ParentID)
		if parent != nil {
			parent.Children = append(parent.Children, it)
		}
	}
	// Rewrite items back with filled-in children.
	for i := range m.Items {
		// Already populated by findTopLevel mutation above — nothing to do.
		_ = m.Items[i]
	}
	return &m, nil
}

// findTopLevel returns a pointer into the provided slice (m.Items) rather
// than a new value so mutations (appending children) stick to the output.
func findTopLevel(items []MenuItem, id string) *MenuItem {
	for i := range items {
		if items[i].ID == id {
			return &items[i]
		}
	}
	return nil
}

// writeMenuItems walks the tree from the input. parentRef is empty for
// top-level items; nested calls pass the real DB uuid. ClientIDs from the
// payload let us reference yet-unpersisted parents in the same request.
func writeMenuItems(ctx context.Context, tx pgx.Tx, menuID string, items []MenuItemInput, parentID string) error {
	for i, it := range items {
		it.Label = strings.TrimSpace(it.Label)
		if it.Label == "" {
			return errors.New("label required on every item")
		}
		if !validLinkTypes[it.LinkType] {
			return errors.New("invalid linkType: " + it.LinkType)
		}
		var parentArg any
		if parentID != "" {
			parentArg = parentID
		}
		var newID string
		err := tx.QueryRow(ctx, `
            INSERT INTO menu_items (menu_id, parent_id, position, label, link_type, target, open_in_new_tab)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING id
        `, menuID, parentArg, i, it.Label, it.LinkType, it.Target, it.OpenInNewTab).Scan(&newID)
		if err != nil {
			return err
		}
		if len(it.Children) > 0 {
			if err := writeMenuItems(ctx, tx, menuID, it.Children, newID); err != nil {
				return err
			}
		}
	}
	return nil
}
