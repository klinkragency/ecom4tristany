package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/3mg/shop/backend/internal/config"
	"github.com/3mg/shop/backend/internal/httpx"
)

// PostHogHandler exposes a thin read-only API for the admin dashboard that
// proxies queries to PostHog's HogQL endpoint. We proxy (rather than letting
// the admin UI hit PostHog directly) so:
//   - The personal API key never ships to the browser.
//   - The admin UI speaks a stable shape decoupled from PostHog's schema.
//   - We can cache or blend with in-house data later.
//
// Config:
//
//	POSTHOG_API_KEY       personal API key with "query:read" permission
//	POSTHOG_PROJECT_ID    numeric project id
//	POSTHOG_HOST          e.g. https://us.posthog.com or https://eu.posthog.com
type PostHogHandler struct {
	cfg *config.Config
	cli *http.Client
}

func NewPostHogHandler(cfg *config.Config) *PostHogHandler {
	return &PostHogHandler{
		cfg: cfg,
		cli: &http.Client{Timeout: 8 * time.Second},
	}
}

type phOverview struct {
	From             time.Time            `json:"from"`
	To               time.Time            `json:"to"`
	Configured       bool                 `json:"configured"`
	DashboardURL     string               `json:"dashboardUrl,omitempty"`
	UniqueVisitors   int                  `json:"uniqueVisitors"`
	TotalEvents      int                  `json:"totalEvents"`
	Pageviews        int                  `json:"pageviews"`
	TopEvents        []phEventBucket      `json:"topEvents"`
	TopPages         []phPageBucket       `json:"topPages"`
	Error            string               `json:"error,omitempty"`
}

type phEventBucket struct {
	Event string `json:"event"`
	Count int    `json:"count"`
}

type phPageBucket struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
}

// Overview is the single consolidated call the admin UI makes. Returns a
// degraded-but-valid response when PostHog isn't configured so the UI can
// show a "connect PostHog" hint instead of a blank error.
func (h *PostHogHandler) Overview(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	out := phOverview{From: dr.From, To: dr.To, TopEvents: []phEventBucket{}, TopPages: []phPageBucket{}}

	if h.cfg.PostHogAPIKey == "" || h.cfg.PostHogProjectID == "" {
		out.Configured = false
		out.Error = "PostHog not configured — set POSTHOG_API_KEY and POSTHOG_PROJECT_ID"
		httpx.JSON(w, http.StatusOK, out)
		return
	}
	out.Configured = true
	out.DashboardURL = fmt.Sprintf("%s/project/%s", h.cfg.PostHogHost, h.cfg.PostHogProjectID)

	// Three independent HogQL queries. Fail-soft: if any errors we still
	// return what we have and leave an `error` message.
	if err := h.runCount(r.Context(),
		`SELECT count(DISTINCT distinct_id) FROM events WHERE timestamp >= {from} AND timestamp < {to}`,
		dr, &out.UniqueVisitors); err != nil {
		out.Error = err.Error()
	}
	if err := h.runCount(r.Context(),
		`SELECT count() FROM events WHERE timestamp >= {from} AND timestamp < {to}`,
		dr, &out.TotalEvents); err != nil && out.Error == "" {
		out.Error = err.Error()
	}
	if err := h.runCount(r.Context(),
		`SELECT count() FROM events WHERE event = '$pageview' AND timestamp >= {from} AND timestamp < {to}`,
		dr, &out.Pageviews); err != nil && out.Error == "" {
		out.Error = err.Error()
	}

	// Top events.
	ev, err := h.runRows(r.Context(),
		`SELECT event, count() as c FROM events WHERE timestamp >= {from} AND timestamp < {to} GROUP BY event ORDER BY c DESC LIMIT 10`,
		dr)
	if err == nil {
		for _, row := range ev {
			if len(row) != 2 {
				continue
			}
			name, _ := row[0].(string)
			count := toInt(row[1])
			out.TopEvents = append(out.TopEvents, phEventBucket{Event: name, Count: count})
		}
	} else if out.Error == "" {
		out.Error = err.Error()
	}

	// Top pages (by $pageview).
	pgs, err := h.runRows(r.Context(),
		`SELECT properties.$pathname, count() as c FROM events WHERE event = '$pageview' AND timestamp >= {from} AND timestamp < {to} GROUP BY properties.$pathname ORDER BY c DESC LIMIT 10`,
		dr)
	if err == nil {
		for _, row := range pgs {
			if len(row) != 2 {
				continue
			}
			path, _ := row[0].(string)
			if path == "" {
				path = "(unknown)"
			}
			count := toInt(row[1])
			out.TopPages = append(out.TopPages, phPageBucket{Path: path, Count: count})
		}
	} else if out.Error == "" {
		out.Error = err.Error()
	}

	httpx.JSON(w, http.StatusOK, out)
}

// ─── HogQL client ───────────────────────────────────────────────────────

// PostHog's HogQL query API: POST /api/projects/{id}/query/
// Request shape:
//   { "query": { "kind": "HogQLQuery", "query": "<SQL>" } }
// Response shape (for SQL queries):
//   { "results": [ [col1, col2, ...], ... ], "columns": [...], "types": [...] }

type hogQLRequest struct {
	Query struct {
		Kind  string `json:"kind"`
		Query string `json:"query"`
	} `json:"query"`
}

type hogQLResponse struct {
	Results [][]any `json:"results"`
}

func (h *PostHogHandler) runQuery(ctx context.Context, sql string, dr dateRange) (*hogQLResponse, error) {
	// Substitute the placeholders. HogQL does have parameter binding but the
	// simpler path for this read-only admin proxy is to interpolate the ISO
	// timestamps directly (they're not user-controlled strings).
	q := sql
	q = replaceAll(q, "{from}", "toDateTime('"+dr.From.UTC().Format("2006-01-02 15:04:05")+"')")
	q = replaceAll(q, "{to}", "toDateTime('"+dr.To.UTC().Format("2006-01-02 15:04:05")+"')")

	var body hogQLRequest
	body.Query.Kind = "HogQLQuery"
	body.Query.Query = q

	buf, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("%s/api/projects/%s/query/", h.cfg.PostHogHost, h.cfg.PostHogProjectID)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(buf))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+h.cfg.PostHogAPIKey)

	resp, err := h.cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		msg, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("posthog %d: %s", resp.StatusCode, truncate(string(msg), 200))
	}
	var out hogQLResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (h *PostHogHandler) runCount(ctx context.Context, sql string, dr dateRange, out *int) error {
	resp, err := h.runQuery(ctx, sql, dr)
	if err != nil {
		return err
	}
	if len(resp.Results) == 0 || len(resp.Results[0]) == 0 {
		return errors.New("empty posthog response")
	}
	*out = toInt(resp.Results[0][0])
	return nil
}

func (h *PostHogHandler) runRows(ctx context.Context, sql string, dr dateRange) ([][]any, error) {
	resp, err := h.runQuery(ctx, sql, dr)
	if err != nil {
		return nil, err
	}
	return resp.Results, nil
}

// ─── tiny helpers ───────────────────────────────────────────────────────

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case float32:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	}
	return 0
}

func replaceAll(s, old, new string) string {
	for {
		i := indexOfSubstr(s, old)
		if i < 0 {
			return s
		}
		s = s[:i] + new + s[i+len(old):]
	}
}

func indexOfSubstr(s, sub string) int {
	if len(sub) == 0 {
		return 0
	}
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
