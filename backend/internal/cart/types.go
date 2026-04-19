package cart

import "time"

type Cart struct {
	ID             string     `json:"id"`
	Token          string     `json:"-"` // cookie value, never exposed to the client as JSON
	CustomerID     *string    `json:"customerId,omitempty"`
	Currency       string     `json:"currency"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	Items          []Item     `json:"items"`
	SubtotalCents  int        `json:"subtotalCents"`
	TotalQuantity  int        `json:"totalQuantity"`
}

type Item struct {
	ID             string    `json:"id"`
	VariantID      string    `json:"variantId"`
	ProductHandle  string    `json:"productHandle"`
	ProductTitle   string    `json:"productTitle"`
	VariantTitle   string    `json:"variantTitle"`
	SKU            string    `json:"sku"`
	ImageURL       string    `json:"imageUrl"`
	UnitPriceCents int       `json:"unitPriceCents"`
	Quantity       int       `json:"quantity"`
	LineTotalCents int       `json:"lineTotalCents"`
	AddedAt        time.Time `json:"addedAt"`
	Available      bool      `json:"available"`
}
