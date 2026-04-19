package order

import "time"

// Order is the admin-facing view. For storefront, see internal/checkout.
type Order struct {
	ID                 string     `json:"id"`
	Number             string     `json:"number"`
	CustomerID         *string    `json:"customerId,omitempty"`
	CustomerName       string     `json:"customerName"`
	Email              string     `json:"email"`
	Phone              string     `json:"phone"`
	Currency           string     `json:"currency"`
	Status             string     `json:"status"`
	FinancialStatus    string     `json:"financialStatus"`
	FulfillmentStatus  string     `json:"fulfillmentStatus"`
	SubtotalCents      int        `json:"subtotalCents"`
	DiscountCents      int        `json:"discountCents"`
	TaxCents           int        `json:"taxCents"`
	ShippingCents      int        `json:"shippingCents"`
	TotalCents         int        `json:"totalCents"`
	Note               string     `json:"note"`
	Tags               []string   `json:"tags"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
	PaidAt             *time.Time `json:"paidAt,omitempty"`
	CancelledAt        *time.Time `json:"cancelledAt,omitempty"`
	FulfilledAt        *time.Time `json:"fulfilledAt,omitempty"`
	LineItems          []LineItem `json:"lineItems"`
	ShippingAddress    *Address   `json:"shippingAddress,omitempty"`
	BillingAddress     *Address   `json:"billingAddress,omitempty"`
	Payments           []Payment  `json:"payments"`
	Events             []Event    `json:"events"`
	TotalRefundedCents int        `json:"totalRefundedCents"`
}

type LineItem struct {
	ID             string `json:"id"`
	VariantID      *string `json:"variantId,omitempty"`
	ProductID      *string `json:"productId,omitempty"`
	ProductTitle   string `json:"productTitle"`
	VariantTitle   string `json:"variantTitle"`
	SKU            string `json:"sku"`
	ImageURL       string `json:"imageUrl"`
	UnitPriceCents int    `json:"unitPriceCents"`
	Quantity       int    `json:"quantity"`
	DiscountCents  int    `json:"discountCents"`
	TaxCents       int    `json:"taxCents"`
	TotalCents     int    `json:"totalCents"`
}

type Address struct {
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Company      string `json:"company"`
	AddressLine1 string `json:"addressLine1"`
	AddressLine2 string `json:"addressLine2"`
	City         string `json:"city"`
	Region       string `json:"region"`
	PostalCode   string `json:"postalCode"`
	Country      string `json:"country"`
	Phone        string `json:"phone"`
}

type Payment struct {
	ID          string    `json:"id"`
	Provider    string    `json:"provider"`
	ProviderRef string    `json:"providerRef"`
	Status      string    `json:"status"`
	AmountCents int       `json:"amountCents"`
	Currency    string    `json:"currency"`
	Brand       string    `json:"brand"`
	Last4       string    `json:"last4"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Event struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	AdminID   *string        `json:"adminId,omitempty"`
	Payload   map[string]any `json:"payload,omitempty"`
	CreatedAt time.Time      `json:"createdAt"`
}

type ListItem struct {
	ID                string    `json:"id"`
	Number            string    `json:"number"`
	Email             string    `json:"email"`
	CustomerName      string    `json:"customerName"`
	Status            string    `json:"status"`
	FinancialStatus   string    `json:"financialStatus"`
	FulfillmentStatus string    `json:"fulfillmentStatus"`
	TotalCents        int       `json:"totalCents"`
	Currency          string    `json:"currency"`
	CreatedAt         time.Time `json:"createdAt"`
	ItemsCount        int       `json:"itemsCount"`
}

type ListPage struct {
	Items      []ListItem `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
	Total      int        `json:"total"`
}
