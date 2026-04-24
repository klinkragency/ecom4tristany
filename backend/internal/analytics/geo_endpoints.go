package analytics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/3mg/shop/backend/internal/geo"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Storefront: geo-hint ───────────────────────────────────────────────

type GeoHintResp struct {
	Country            string `json:"country"`            // "" when we can't tell
	SuggestedCurrency  string `json:"suggestedCurrency"`  // "" when no mapping OR not active on this shop
}

// GeoHintHandler is a lightweight public endpoint the storefront hits once
// on first visit to decide whether to show the "switch currency?" banner.
// It deliberately doesn't set any cookies — the client decides what to do
// with the suggestion.
type GeoHintHandler struct {
	db *pgxpool.Pool
}

func NewGeoHintHandler(db *pgxpool.Pool) *GeoHintHandler {
	return &GeoHintHandler{db: db}
}

func (h *GeoHintHandler) Hint(w http.ResponseWriter, r *http.Request) {
	country := geo.DetectCountry(r)
	suggested := geo.SuggestCurrency(country)

	// Only suggest a currency that's actually configured + active on this
	// shop. No point telling a buyer "switch to USD" if the merchant
	// didn't enable USD.
	if suggested != "" {
		var active bool
		_ = h.db.QueryRow(r.Context(),
			`SELECT active FROM currencies WHERE code = $1`, suggested,
		).Scan(&active)
		if !active {
			suggested = ""
		}
	}
	httpx.JSON(w, http.StatusOK, GeoHintResp{
		Country:           country,
		SuggestedCurrency: suggested,
	})
}

// ─── Admin: sessions by country ─────────────────────────────────────────

type SessionByCountry struct {
	Country  string `json:"country"`
	Sessions int    `json:"sessions"`
}

type SessionsByCountryResp struct {
	From           time.Time          `json:"from"`
	WindowMinutes  int                `json:"windowMinutes"`
	TotalSessions  int                `json:"totalSessions"`
	Items          []SessionByCountry `json:"items"`
}

// SessionsByCountry returns the count of active sessions grouped by country
// for the last N minutes (default 5 — the "right now" window most shops
// want to see). Excludes sessions with an empty country (we couldn't
// detect origin for those).
func (h *Handler) SessionsByCountry(w http.ResponseWriter, r *http.Request) {
	mins, _ := strconv.Atoi(r.URL.Query().Get("minutes"))
	if mins <= 0 || mins > 60*24 {
		mins = 5
	}
	from := time.Now().Add(-time.Duration(mins) * time.Minute)

	rows, err := h.db.Query(r.Context(), `
        SELECT country, COUNT(*)::int
        FROM analytics_sessions
        WHERE last_seen >= $1 AND country <> ''
        GROUP BY country
        ORDER BY COUNT(*) DESC, country
    `, from)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()

	out := SessionsByCountryResp{From: from, WindowMinutes: mins, Items: []SessionByCountry{}}
	for rows.Next() {
		var it SessionByCountry
		if err := rows.Scan(&it.Country, &it.Sessions); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out.Items = append(out.Items, it)
		out.TotalSessions += it.Sessions
	}
	// Also include the unknown-country bucket so admins see real totals
	// (helps notice "we detect zero countries" misconfigurations quickly).
	var unknown int
	_ = h.db.QueryRow(r.Context(), `
        SELECT COUNT(*) FROM analytics_sessions WHERE last_seen >= $1 AND country = ''
    `, from).Scan(&unknown)
	if unknown > 0 {
		out.Items = append(out.Items, SessionByCountry{Country: "??", Sessions: unknown})
		out.TotalSessions += unknown
	}
	httpx.JSON(w, http.StatusOK, out)
}
