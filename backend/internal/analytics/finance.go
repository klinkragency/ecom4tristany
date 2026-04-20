package analytics

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"
	"github.com/3mg/shop/backend/internal/payments"

	"github.com/jackc/pgx/v5/pgxpool"
)

// FinanceHandler has access to the Stripe client (for payouts) in addition
// to the DB. The plain analytics.Handler doesn't, which keeps the event
// ingest path from depending on Stripe configuration being present.
type FinanceHandler struct {
	db  *pgxpool.Pool
	pay *payments.Client
}

func NewFinanceHandler(db *pgxpool.Pool, pay *payments.Client) *FinanceHandler {
	return &FinanceHandler{db: db, pay: pay}
}

// ─── Sales report (revenue + VAT by country) ────────────────────────────

type SalesRow struct {
	Country           string `json:"country"`
	OrdersPaid        int    `json:"ordersPaid"`
	GrossRevenueCents int    `json:"grossRevenueCents"`
	TaxCollectedCents int    `json:"taxCollectedCents"`
	ShippingCents     int    `json:"shippingCents"`
	DiscountedCents   int    `json:"discountedCents"`
}

// SalesReport aggregates paid orders by shipping-country. This is the
// report accountants want for EU VAT filings — it groups by the country
// where the goods shipped (the VAT jurisdiction under EU OSS rules).
func (h *FinanceHandler) SalesReport(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	rows, err := h.db.Query(r.Context(), `
        SELECT
          COALESCE(sa.country, '—') AS country,
          COUNT(*)::int AS paid,
          COALESCE(SUM(o.total_cents), 0)::int AS gross,
          COALESCE(SUM(o.tax_cents), 0)::int AS tax,
          COALESCE(SUM(o.shipping_cents), 0)::int AS shipping,
          COALESCE(SUM(o.discount_cents), 0)::int AS discount
        FROM orders o
        LEFT JOIN order_addresses sa
          ON sa.order_id = o.id AND sa.kind = 'shipping'
        WHERE o.created_at >= $1 AND o.created_at < $2
          AND o.financial_status IN ('paid','partially_refunded','refunded')
        GROUP BY COALESCE(sa.country, '—')
        ORDER BY gross DESC
    `, dr.From, dr.To)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_error", err.Error())
		return
	}
	defer rows.Close()
	items := []SalesRow{}
	for rows.Next() {
		var s SalesRow
		if err := rows.Scan(&s.Country, &s.OrdersPaid, &s.GrossRevenueCents,
			&s.TaxCollectedCents, &s.ShippingCents, &s.DiscountedCents); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		items = append(items, s)
	}
	if r.URL.Query().Get("format") == "csv" {
		writeSalesCSV(w, dr, items)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"from":  dr.From,
		"to":    dr.To,
		"items": items,
	})
}

func writeSalesCSV(w http.ResponseWriter, dr dateRange, items []SalesRow) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="sales-%s-to-%s.csv"`,
			dr.From.Format("20060102"), dr.To.Format("20060102")))
	c := csv.NewWriter(w)
	_ = c.Write([]string{"country", "orders_paid", "gross_revenue_eur", "tax_eur", "shipping_eur", "discount_eur"})
	for _, s := range items {
		_ = c.Write([]string{
			s.Country,
			strconv.Itoa(s.OrdersPaid),
			eurStr(s.GrossRevenueCents),
			eurStr(s.TaxCollectedCents),
			eurStr(s.ShippingCents),
			eurStr(s.DiscountedCents),
		})
	}
	c.Flush()
}

// ─── Refund report (card vs store credit) ───────────────────────────────

type RefundBucket struct {
	Reason       string `json:"reason"`
	Count        int    `json:"count"`
	AmountCents  int    `json:"amountCents"`
}

type RefundsResp struct {
	From              time.Time      `json:"from"`
	To                time.Time      `json:"to"`
	TotalCount        int            `json:"totalCount"`
	TotalCents        int            `json:"totalCents"`
	CardCents         int            `json:"cardCents"`
	StoreCreditCents  int            `json:"storeCreditCents"`
	ByReason          []RefundBucket `json:"byReason"`
}

func (h *FinanceHandler) RefundsReport(w http.ResponseWriter, r *http.Request) {
	dr, err := parseRange(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_range", err.Error())
		return
	}
	out := RefundsResp{From: dr.From, To: dr.To, ByReason: []RefundBucket{}}
	_ = h.db.QueryRow(r.Context(), `
        SELECT
          COALESCE(COUNT(*), 0),
          COALESCE(SUM(amount_cents), 0),
          COALESCE(SUM(amount_cents) FILTER (WHERE reason LIKE 'card_refund%' OR reason LIKE 'return_refund_card%' OR provider_ref IS NOT NULL), 0),
          COALESCE(SUM(amount_cents) FILTER (WHERE reason LIKE 'store_credit_refund%' OR reason LIKE 'return_refund_store_credit%'), 0)
        FROM refunds
        WHERE created_at >= $1 AND created_at < $2
    `, dr.From, dr.To).Scan(&out.TotalCount, &out.TotalCents, &out.CardCents, &out.StoreCreditCents)

	rows, err := h.db.Query(r.Context(), `
        SELECT
          -- normalise prefixes so the admin sees short reasons
          CASE
            WHEN reason LIKE 'card_refund:%' OR reason = 'card_refund' THEN substring(reason from length('card_refund:') + 1)
            WHEN reason LIKE 'store_credit_refund:%' OR reason = 'store_credit_refund' THEN substring(reason from length('store_credit_refund:') + 1)
            WHEN reason LIKE 'return_refund_%' THEN 'return'
            WHEN reason = 'stripe_dashboard' THEN 'stripe_dashboard'
            ELSE reason
          END AS bucket,
          COUNT(*)::int,
          COALESCE(SUM(amount_cents), 0)::int
        FROM refunds
        WHERE created_at >= $1 AND created_at < $2
        GROUP BY 1 ORDER BY 3 DESC
    `, dr.From, dr.To)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var b RefundBucket
			if err := rows.Scan(&b.Reason, &b.Count, &b.AmountCents); err == nil {
				if b.Reason == "" {
					b.Reason = "—"
				}
				out.ByReason = append(out.ByReason, b)
			}
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

// ─── Store credit liability ─────────────────────────────────────────────

type StoreCreditResp struct {
	TotalLiabilityCents int `json:"totalLiabilityCents"`
	CustomerCount       int `json:"customerCount"`
	Currency            string `json:"currency"`
}

// StoreCreditLiability is the sum of positive balances across all customer
// accounts — the shop's outstanding obligation to customers holding credit.
// Reported as a single number on the finance dashboard; the accountant
// typically records it as a liability on the balance sheet.
func (h *FinanceHandler) StoreCreditLiability(w http.ResponseWriter, r *http.Request) {
	var out StoreCreditResp
	out.Currency = "EUR"
	_ = h.db.QueryRow(r.Context(), `
        SELECT
          COALESCE(SUM(balance_cents), 0),
          COUNT(*) FILTER (WHERE balance_cents > 0)
        FROM store_credit_accounts
    `).Scan(&out.TotalLiabilityCents, &out.CustomerCount)
	httpx.JSON(w, http.StatusOK, out)
}

// ─── Stripe payouts ─────────────────────────────────────────────────────

func (h *FinanceHandler) Payouts(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 25
	}
	items, err := h.pay.ListPayouts(limit)
	if err != nil {
		httpx.Error(w, http.StatusBadGateway, "stripe_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
}

// ─── Helpers ────────────────────────────────────────────────────────────

func eurStr(cents int) string {
	neg := ""
	c := cents
	if c < 0 {
		neg = "-"
		c = -c
	}
	return fmt.Sprintf("%s%d.%02d", neg, c/100, c%100)
}
