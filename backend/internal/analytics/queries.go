package analytics

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"
)

// ─── Request parsing ────────────────────────────────────────────────────

type dateRange struct {
	From time.Time
	To   time.Time
}

// parseRange reads ?from=...&to=... (RFC3339 or YYYY-MM-DD) with a sensible
// 30-day-back default. Also parses ?granularity=day|week|month (default day).
// Hour granularity is intentionally omitted — at our query cadence it's noisy.
func parseRange(r *http.Request) (dateRange, error) {
	q := r.URL.Query()
	now := time.Now().UTC()
	to := now
	from := now.AddDate(0, 0, -30)
	if s := q.Get("to"); s != "" {
		t, err := parseFlexible(s)
		if err != nil {
			return dateRange{}, err
		}
		to = t
	}
	if s := q.Get("from"); s != "" {
		t, err := parseFlexible(s)
		if err != nil {
			return dateRange{}, err
		}
		from = t
	}
	if !from.Before(to) {
		return dateRange{}, errors.New("from must be before to")
	}
	return dateRange{From: from, To: to}, nil
}

func parseFlexible(s string) (time.Time, error) {
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t, nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Time{}, errors.New("invalid date: " + s)
}

func parseGranularity(r *http.Request) string {
	switch r.URL.Query().Get("granularity") {
	case "week":
		return "week"
	case "month":
		return "month"
	default:
		return "day"
	}
}

// ─── Summary KPI ────────────────────────────────────────────────────────

type SummaryResp struct {
	From              time.Time `json:"from"`
	To                time.Time `json:"to"`
	OrdersPlaced      int       `json:"ordersPlaced"`      // created regardless of status
	OrdersPaid        int       `json:"ordersPaid"`
	GrossRevenueCents int       `json:"grossRevenueCents"` // sum(total_cents) of paid orders
	NetRevenueCents   int       `json:"netRevenueCents"`   // gross − refunds
	RefundedCents     int       `json:"refundedCents"`
	AvgOrderCents     int       `json:"avgOrderCents"`
	TaxCollectedCents int       `json:"taxCollectedCents"`
	DiscountedCents   int       `json:"discountedCents"`
	StoreCreditUsedCents int    `json:"storeCreditUsedCents"`

	// Funnel (depends on event ingest running)
	Sessions         int `json:"sessions"`
	ProductViews     int `json:"productViews"`
	CartAdds         int `json:"cartAdds"`
	CheckoutsStarted int `json:"checkoutsStarted"`
	ConversionPct    float64 `json:"conversionPct"` // sessions → paid
}

func (h *Handler) Summary(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	out := SummaryResp{From: dr.From, To: dr.To}

	// Order-derived metrics.
	err = h.db.QueryRow(r.Context(), `
        WITH paid_orders AS (
          SELECT id, total_cents, tax_cents, discount_cents, store_credit_cents
          FROM orders
          WHERE created_at >= $1 AND created_at < $2
            AND financial_status IN ('paid','partially_refunded','refunded')
        ),
        all_orders AS (
          SELECT id FROM orders
          WHERE created_at >= $1 AND created_at < $2
        ),
        refund_sum AS (
          SELECT COALESCE(SUM(amount_cents), 0) AS total
          FROM refunds WHERE created_at >= $1 AND created_at < $2
        )
        SELECT
          (SELECT COUNT(*) FROM all_orders),
          (SELECT COUNT(*) FROM paid_orders),
          COALESCE((SELECT SUM(total_cents) FROM paid_orders), 0),
          COALESCE((SELECT SUM(tax_cents) FROM paid_orders), 0),
          COALESCE((SELECT SUM(discount_cents) FROM paid_orders), 0),
          COALESCE((SELECT SUM(store_credit_cents) FROM paid_orders), 0),
          (SELECT total FROM refund_sum)
    `, dr.From, dr.To).Scan(&out.OrdersPlaced, &out.OrdersPaid, &out.GrossRevenueCents,
		&out.TaxCollectedCents, &out.DiscountedCents, &out.StoreCreditUsedCents,
		&out.RefundedCents)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "summary_error", err.Error())
		return
	}
	out.NetRevenueCents = out.GrossRevenueCents - out.RefundedCents
	if out.OrdersPaid > 0 {
		out.AvgOrderCents = out.GrossRevenueCents / out.OrdersPaid
	}

	// Funnel metrics — lean on the event table. Fall back silently to 0 if
	// the event pipeline isn't wired on the storefront yet.
	_ = h.db.QueryRow(r.Context(), `
        SELECT
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'page_view'),
          COUNT(*) FILTER (WHERE kind = 'product_view'),
          COUNT(*) FILTER (WHERE kind = 'cart_add'),
          COUNT(*) FILTER (WHERE kind = 'checkout_started')
        FROM analytics_events
        WHERE occurred_at >= $1 AND occurred_at < $2
    `, dr.From, dr.To).Scan(&out.Sessions, &out.ProductViews, &out.CartAdds, &out.CheckoutsStarted)
	if out.Sessions > 0 {
		out.ConversionPct = float64(out.OrdersPaid) / float64(out.Sessions) * 100.0
	}

	httpx.JSON(w, http.StatusOK, out)
}

// ─── Sales time series ──────────────────────────────────────────────────

type SalesPoint struct {
	Bucket        time.Time `json:"bucket"`
	OrderCount    int       `json:"orderCount"`
	RevenueCents  int       `json:"revenueCents"`
	RefundedCents int       `json:"refundedCents"`
}

type SalesResp struct {
	From        time.Time    `json:"from"`
	To          time.Time    `json:"to"`
	Granularity string       `json:"granularity"`
	Points      []SalesPoint `json:"points"`
}

func (h *Handler) Sales(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	granularity := parseGranularity(r)
	trunc := "day"
	if granularity == "week" {
		trunc = "week"
	}
	if granularity == "month" {
		trunc = "month"
	}

	// Revenue is attributed to the order's created_at bucket.
	rows, err := h.db.Query(r.Context(), `
        SELECT
          date_trunc($3, created_at) AS bucket,
          COUNT(*) AS order_count,
          COALESCE(SUM(total_cents), 0) AS revenue
        FROM orders
        WHERE created_at >= $1 AND created_at < $2
          AND financial_status IN ('paid','partially_refunded','refunded')
        GROUP BY 1 ORDER BY 1
    `, dr.From, dr.To, trunc)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "sales_query", err.Error())
		return
	}
	defer rows.Close()

	var buckets []struct_bucket
	for rows.Next() {
		var b struct_bucket
		if err := rows.Scan(&b.bucket, &b.orderCount, &b.revenueCents); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		buckets = append(buckets, b)
	}

	// Refunds in the same window — attributed to refund.created_at.
	refundRows, err := h.db.Query(r.Context(), `
        SELECT
          date_trunc($3, created_at) AS bucket,
          COALESCE(SUM(amount_cents), 0) AS total
        FROM refunds
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1
    `, dr.From, dr.To, trunc)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "refund_query", err.Error())
		return
	}
	refundsByBucket := map[int64]int{}
	for refundRows.Next() {
		var b time.Time
		var c int
		if err := refundRows.Scan(&b, &c); err != nil {
			refundRows.Close()
			httpx.Error(w, http.StatusInternalServerError, "refund_scan", err.Error())
			return
		}
		refundsByBucket[b.Unix()] = c
	}
	refundRows.Close()

	// Dense fill: include 0-rows for buckets with no orders so charts don't
	// compress time visually.
	points := fillBuckets(dr.From, dr.To, granularity, buckets, refundsByBucket)

	httpx.JSON(w, http.StatusOK, SalesResp{
		From: dr.From, To: dr.To, Granularity: granularity, Points: points,
	})
}

func fillBuckets(from, to time.Time, granularity string, buckets []struct_bucket, refunds map[int64]int) []SalesPoint {
	byBucket := map[int64]struct_bucket{}
	for _, b := range buckets {
		byBucket[b.bucket.Unix()] = b
	}
	step := func(t time.Time) time.Time {
		switch granularity {
		case "week":
			return t.AddDate(0, 0, 7)
		case "month":
			return t.AddDate(0, 1, 0)
		default:
			return t.AddDate(0, 0, 1)
		}
	}
	truncate := func(t time.Time) time.Time {
		switch granularity {
		case "week":
			// Monday as week start (Postgres default).
			wd := int(t.Weekday())
			if wd == 0 {
				wd = 7
			}
			return time.Date(t.Year(), t.Month(), t.Day()-(wd-1), 0, 0, 0, 0, time.UTC)
		case "month":
			return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
		default:
			return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		}
	}

	out := []SalesPoint{}
	for cur := truncate(from); !cur.After(to); cur = step(cur) {
		p := SalesPoint{Bucket: cur}
		if b, ok := byBucket[cur.Unix()]; ok {
			p.OrderCount = b.orderCount
			p.RevenueCents = b.revenueCents
		}
		if c, ok := refunds[cur.Unix()]; ok {
			p.RefundedCents = c
		}
		out = append(out, p)
	}
	return out
}

// tiny private alias so fillBuckets' signature can name the anonymous
// struct type without reaching into the calling function.
type struct_bucket = struct {
	bucket       time.Time
	orderCount   int
	revenueCents int
}

// ─── Top products ───────────────────────────────────────────────────────

type TopProduct struct {
	ProductID    string `json:"productId"`
	Title        string `json:"title"`
	Handle       string `json:"handle"`
	UnitsSold    int    `json:"unitsSold"`
	RevenueCents int    `json:"revenueCents"`
}

func (h *Handler) TopProducts(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	by := r.URL.Query().Get("by")
	orderBy := "revenue_cents DESC"
	if by == "units" {
		orderBy = "units_sold DESC"
	}
	limit := 10
	if n, _ := strconv.Atoi(r.URL.Query().Get("limit")); n > 0 && n <= 100 {
		limit = n
	}

	rows, err := h.db.Query(r.Context(), `
        SELECT
          p.id, p.title, p.handle,
          SUM(oli.quantity)::int AS units_sold,
          SUM(oli.total_cents)::int AS revenue_cents
        FROM order_line_items oli
        JOIN orders o ON o.id = oli.order_id
        JOIN products p ON p.id = oli.product_id
        WHERE o.created_at >= $1 AND o.created_at < $2
          AND o.financial_status IN ('paid','partially_refunded','refunded')
        GROUP BY p.id, p.title, p.handle
        ORDER BY `+orderBy+`
        LIMIT $3
    `, dr.From, dr.To, limit)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "top_products_query", err.Error())
		return
	}
	defer rows.Close()
	out := []TopProduct{}
	for rows.Next() {
		var p TopProduct
		if err := rows.Scan(&p.ProductID, &p.Title, &p.Handle, &p.UnitsSold, &p.RevenueCents); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "top_products_scan", err.Error())
			return
		}
		out = append(out, p)
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out, "from": dr.From, "to": dr.To})
}

// ─── Conversion funnel ──────────────────────────────────────────────────

type FunnelStep struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type FunnelResp struct {
	From  time.Time    `json:"from"`
	To    time.Time    `json:"to"`
	Steps []FunnelStep `json:"steps"`
}

func (h *Handler) Funnel(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	var sessions, productViews, cartAdds, checkoutStarted, ordersPaid int
	_ = h.db.QueryRow(r.Context(), `
        SELECT
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'page_view'),
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'product_view'),
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'cart_add'),
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'checkout_started'),
          COUNT(DISTINCT session_id) FILTER (WHERE kind = 'checkout_completed')
        FROM analytics_events
        WHERE occurred_at >= $1 AND occurred_at < $2
    `, dr.From, dr.To).Scan(&sessions, &productViews, &cartAdds, &checkoutStarted, &ordersPaid)

	httpx.JSON(w, http.StatusOK, FunnelResp{
		From: dr.From, To: dr.To,
		Steps: []FunnelStep{
			{Name: "Visits", Count: sessions},
			{Name: "Product views", Count: productViews},
			{Name: "Cart adds", Count: cartAdds},
			{Name: "Checkouts started", Count: checkoutStarted},
			{Name: "Orders paid", Count: ordersPaid},
		},
	})
}

// ─── Small util ─────────────────────────────────────────────────────────

// lowerTrim uppercases + trims; used by filter parsers in finance.go.
func lowerTrim(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// ensureContext is a harmless local to keep context imported in callers that
// might be compiled out in tests.
var _ = func(ctx context.Context) {}
