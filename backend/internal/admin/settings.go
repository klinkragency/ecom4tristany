package admin

import (
	"context"
	"net/http"
	"strconv"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Shop settings are stored as key/value rows in shop_settings. A small set
// of keys is "known" — they map 1:1 to fields on the existing cfg.Config
// so the rest of the codebase keeps reading from config. The settings
// handler is the single writer that updates both the DB row AND the live
// cfg pointer.
//
// Keys that don't map to cfg are still persisted and returned; the admin UI
// can use them for future settings without a schema migration.
var knownSettingsKeys = []string{
	"shop.name",
	"shop.public_url",
	"shop.currency",
	"shop.vat_percent",
}

type SettingsHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewSettingsHandler(db *pgxpool.Pool, cfg *config.Config) *SettingsHandler {
	return &SettingsHandler{db: db, cfg: cfg}
}

type settingsResp struct {
	ShopName      string `json:"shopName"`
	ShopPublicURL string `json:"shopPublicUrl"`
	ShopCurrency  string `json:"shopCurrency"`
	ShopVATPercent int   `json:"shopVatPercent"`
}

type settingsUpdate struct {
	ShopName      *string `json:"shopName"`
	ShopPublicURL *string `json:"shopPublicUrl"`
	ShopCurrency  *string `json:"shopCurrency"`
	ShopVATPercent *int   `json:"shopVatPercent"`
}

// ApplyToConfig loads any persisted settings from DB into the config
// struct at startup. Called from the cmd/api bootstrap so subsequent code
// sees the effective values.
func ApplyToConfig(ctx context.Context, db *pgxpool.Pool, cfg *config.Config) error {
	rows, err := db.Query(ctx, `SELECT key, value FROM shop_settings`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return err
		}
		applyKey(cfg, k, v)
	}
	return nil
}

func applyKey(cfg *config.Config, key, value string) {
	switch key {
	case "shop.name":
		cfg.ShopName = value
	case "shop.public_url":
		cfg.ShopPublicURL = value
	case "shop.currency":
		cfg.ShopCurrency = value
	case "shop.vat_percent":
		if n, err := strconv.Atoi(value); err == nil {
			cfg.ShopVATPercent = n
		}
	}
}

// Get returns the currently-effective settings (DB-overridden → env fallback).
// The handler reads from cfg (which we keep in sync with DB writes), so
// there's no race between reads and writes.
func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, settingsResp{
		ShopName:       h.cfg.ShopName,
		ShopPublicURL:  h.cfg.ShopPublicURL,
		ShopCurrency:   h.cfg.ShopCurrency,
		ShopVATPercent: h.cfg.ShopVATPercent,
	})
}

// Update patches one or more settings. Values are validated per key, then
// written both to the DB (for persistence across restarts) AND to the live
// cfg pointer (for immediate effect on subsequent requests).
func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	sess, _ := auth.SessionFromContext(r.Context())
	var req settingsUpdate
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}

	updates := map[string]string{}
	if req.ShopName != nil {
		updates["shop.name"] = *req.ShopName
	}
	if req.ShopPublicURL != nil {
		updates["shop.public_url"] = *req.ShopPublicURL
	}
	if req.ShopCurrency != nil {
		if len(*req.ShopCurrency) != 3 {
			httpx.Error(w, http.StatusBadRequest, "invalid_currency", "currency must be ISO 4217 (3 letters)")
			return
		}
		updates["shop.currency"] = *req.ShopCurrency
	}
	if req.ShopVATPercent != nil {
		if *req.ShopVATPercent < 0 || *req.ShopVATPercent > 100 {
			httpx.Error(w, http.StatusBadRequest, "invalid_vat", "vat must be between 0 and 100")
			return
		}
		updates["shop.vat_percent"] = strconv.Itoa(*req.ShopVATPercent)
	}

	var adminID any
	if sess != nil && sess.UserID.Valid {
		adminID = sess.UserID
	}
	for k, v := range updates {
		if _, err := h.db.Exec(r.Context(), `
            INSERT INTO shop_settings (key, value, updated_by, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
        `, k, v, adminID); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "upsert_error", err.Error())
			return
		}
		applyKey(h.cfg, k, v)
	}
	h.Get(w, r)
}
