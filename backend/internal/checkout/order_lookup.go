package checkout

import (
	"errors"
	"net/http"
	"time"

	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// StorefrontOrder is a trimmed-down view for the post-checkout "thank you" page.
type StorefrontOrder struct {
	ID               string       `json:"id"`
	Number           string       `json:"number"`
	Email            string       `json:"email"`
	Status           string       `json:"status"`
	FinancialStatus  string       `json:"financialStatus"`
	Currency         string       `json:"currency"`
	SubtotalCents    int          `json:"subtotalCents"`
	DiscountCents    int          `json:"discountCents"`
	TaxCents         int          `json:"taxCents"`
	ShippingCents    int          `json:"shippingCents"`
	TotalCents       int          `json:"totalCents"`
	CreatedAt        time.Time    `json:"createdAt"`
	PaidAt           *time.Time   `json:"paidAt,omitempty"`
	LineItems        []LineItem   `json:"lineItems"`
	ShippingAddress  *Address     `json:"shippingAddress,omitempty"`
	BillingAddress   *Address     `json:"billingAddress,omitempty"`
}

type LineItem struct {
	ID             string `json:"id"`
	ProductTitle   string `json:"productTitle"`
	VariantTitle   string `json:"variantTitle"`
	SKU            string `json:"sku"`
	ImageURL       string `json:"imageUrl"`
	UnitPriceCents int    `json:"unitPriceCents"`
	Quantity       int    `json:"quantity"`
	TotalCents     int    `json:"totalCents"`
}

// GetStorefrontOrder returns an order by ID. No auth: the order ID is a UUID,
// only the customer who just placed the order or a staff member can have it.
// Follow-up: sign the order_id in the post-checkout redirect URL to harden.
func (h *Handler) GetStorefrontOrder(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var o StorefrontOrder
	err := h.db.QueryRow(r.Context(), `
        SELECT id, number, email, status, financial_status, currency,
               subtotal_cents, discount_cents, tax_cents, shipping_cents, total_cents,
               created_at, paid_at
        FROM orders WHERE id = $1
    `, id).Scan(&o.ID, &o.Number, &o.Email, &o.Status, &o.FinancialStatus, &o.Currency,
		&o.SubtotalCents, &o.DiscountCents, &o.TaxCents, &o.ShippingCents, &o.TotalCents,
		&o.CreatedAt, &o.PaidAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "order not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	rows, err := h.db.Query(r.Context(), `
        SELECT id, product_title, variant_title, sku, image_url,
               unit_price_cents, quantity, total_cents
        FROM order_line_items WHERE order_id = $1 ORDER BY created_at
    `, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "lines_error", err.Error())
		return
	}
	for rows.Next() {
		var li LineItem
		if err := rows.Scan(&li.ID, &li.ProductTitle, &li.VariantTitle, &li.SKU,
			&li.ImageURL, &li.UnitPriceCents, &li.Quantity, &li.TotalCents); err != nil {
			rows.Close()
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		o.LineItems = append(o.LineItems, li)
	}
	rows.Close()

	addrRows, err := h.db.Query(r.Context(), `
        SELECT kind, first_name, last_name, company, address_line1, address_line2,
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
		var a Address
		if err := addrRows.Scan(&kind, &a.FirstName, &a.LastName, &a.Company,
			&a.AddressLine1, &a.AddressLine2, &a.City, &a.Region, &a.PostalCode,
			&a.Country, &a.Phone); err != nil {
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
