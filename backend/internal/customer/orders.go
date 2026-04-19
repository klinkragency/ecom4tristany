package customer

import (
	"errors"
	"net/http"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type OrderListItem struct {
	ID                 string    `json:"id"`
	Number             string    `json:"number"`
	Status             string    `json:"status"`
	FinancialStatus    string    `json:"financialStatus"`
	FulfillmentStatus  string    `json:"fulfillmentStatus"`
	TotalCents         int       `json:"totalCents"`
	Currency           string    `json:"currency"`
	CreatedAt          time.Time `json:"createdAt"`
	ItemsCount         int       `json:"itemsCount"`
}

type OrderLine struct {
	ID             string `json:"id"`
	ProductTitle   string `json:"productTitle"`
	VariantTitle   string `json:"variantTitle"`
	ImageURL       string `json:"imageUrl"`
	UnitPriceCents int    `json:"unitPriceCents"`
	Quantity       int    `json:"quantity"`
	TotalCents     int    `json:"totalCents"`
}

type OrderAddress struct {
	FirstName, LastName, AddressLine1, AddressLine2 string `json:",omitempty"`
	City, Region, PostalCode, Country, Phone        string `json:",omitempty"`
}

type OrderDetail struct {
	ID                string        `json:"id"`
	Number            string        `json:"number"`
	Status            string        `json:"status"`
	FinancialStatus   string        `json:"financialStatus"`
	FulfillmentStatus string        `json:"fulfillmentStatus"`
	Currency          string        `json:"currency"`
	SubtotalCents     int           `json:"subtotalCents"`
	ShippingCents     int           `json:"shippingCents"`
	TaxCents          int           `json:"taxCents"`
	StoreCreditCents  int           `json:"storeCreditCents"`
	TotalCents        int           `json:"totalCents"`
	CreatedAt         time.Time     `json:"createdAt"`
	PaidAt            *time.Time    `json:"paidAt,omitempty"`
	LineItems         []OrderLine   `json:"lineItems"`
	ShippingAddress   *OrderAddress `json:"shippingAddress,omitempty"`
	BillingAddress    *OrderAddress `json:"billingAddress,omitempty"`
}

func (h *Handler) ListMyOrders(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	rows, err := h.db.Query(r.Context(), `
        SELECT o.id, o.number, o.status, o.financial_status, o.fulfillment_status,
               o.total_cents, o.currency, o.created_at,
               COALESCE((SELECT SUM(quantity) FROM order_line_items WHERE order_id = o.id), 0)
        FROM orders o
        WHERE o.customer_id = $1
        ORDER BY o.created_at DESC
        LIMIT 50
    `, cid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []OrderListItem{}
	for rows.Next() {
		var it OrderListItem
		if err := rows.Scan(&it.ID, &it.Number, &it.Status, &it.FinancialStatus,
			&it.FulfillmentStatus, &it.TotalCents, &it.Currency, &it.CreatedAt,
			&it.ItemsCount); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		out = append(out, it)
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) GetMyOrder(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}
	id := chi.URLParam(r, "id")

	var o OrderDetail
	err := h.db.QueryRow(r.Context(), `
        SELECT id, number, status, financial_status, fulfillment_status, currency,
               subtotal_cents, shipping_cents, tax_cents, store_credit_cents, total_cents,
               created_at, paid_at
        FROM orders WHERE id = $1 AND customer_id = $2
    `, id, cid).Scan(&o.ID, &o.Number, &o.Status, &o.FinancialStatus, &o.FulfillmentStatus,
		&o.Currency, &o.SubtotalCents, &o.ShippingCents, &o.TaxCents,
		&o.StoreCreditCents, &o.TotalCents, &o.CreatedAt, &o.PaidAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	lineRows, err := h.db.Query(r.Context(), `
        SELECT id, product_title, variant_title, image_url, unit_price_cents, quantity, total_cents
        FROM order_line_items WHERE order_id = $1 ORDER BY created_at
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lines_error", err.Error())
		return
	}
	for lineRows.Next() {
		var li OrderLine
		if err := lineRows.Scan(&li.ID, &li.ProductTitle, &li.VariantTitle, &li.ImageURL,
			&li.UnitPriceCents, &li.Quantity, &li.TotalCents); err != nil {
			lineRows.Close()
			httpx.Error(w, http.StatusInternalServerError, "line_scan", err.Error())
			return
		}
		o.LineItems = append(o.LineItems, li)
	}
	lineRows.Close()

	addrRows, err := h.db.Query(r.Context(), `
        SELECT kind, first_name, last_name, address_line1, address_line2,
               city, region, postal_code, country, phone
        FROM order_addresses WHERE order_id = $1
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "addr_error", err.Error())
		return
	}
	defer addrRows.Close()
	for addrRows.Next() {
		var kind string
		var a OrderAddress
		if err := addrRows.Scan(&kind, &a.FirstName, &a.LastName, &a.AddressLine1,
			&a.AddressLine2, &a.City, &a.Region, &a.PostalCode, &a.Country, &a.Phone); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "addr_scan", err.Error())
			return
		}
		if kind == "shipping" {
			o.ShippingAddress = &a
		} else {
			o.BillingAddress = &a
		}
	}

	httpx.JSON(w, http.StatusOK, o)
}

// StoreCreditLedger returns the customer's store-credit history. One-off
// public view — the admin sees the same shape.
type LedgerEntry struct {
	ID         string    `json:"id"`
	DeltaCents int       `json:"deltaCents"`
	Reason     string    `json:"reason"`
	Note       string    `json:"note"`
	OrderID    *string   `json:"orderId,omitempty"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (h *Handler) MyStoreCredit(w http.ResponseWriter, r *http.Request) {
	cid, ok := customerID(r)
	if !ok {
		httpx.Error(w, http.StatusUnauthorized, "unauthorized", "not authenticated")
		return
	}

	var balance int
	var currency string
	err := h.db.QueryRow(r.Context(), `
        SELECT COALESCE(balance_cents, 0), COALESCE(currency, 'EUR')
        FROM store_credit_accounts WHERE customer_id = $1
    `, cid).Scan(&balance, &currency)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		currency = "EUR"
	}

	rows, err := h.db.Query(r.Context(), `
        SELECT id, delta_cents, reason, note, order_id, created_at
        FROM store_credit_ledger WHERE customer_id = $1
        ORDER BY created_at DESC LIMIT 50
    `, cid)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "ledger_error", err.Error())
		return
	}
	defer rows.Close()
	entries := []LedgerEntry{}
	for rows.Next() {
		var e LedgerEntry
		var oid *string
		if err := rows.Scan(&e.ID, &e.DeltaCents, &e.Reason, &e.Note, &oid, &e.CreatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		e.OrderID = oid
		entries = append(entries, e)
	}

	httpx.JSON(w, http.StatusOK, map[string]any{
		"balanceCents": balance,
		"currency":     currency,
		"entries":      entries,
	})
}
