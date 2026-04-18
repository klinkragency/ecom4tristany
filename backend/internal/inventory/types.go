package inventory

import "time"

type Location struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	IsActive      bool      `json:"isActive"`
	IsFulfillment bool      `json:"isFulfillment"`
	AddressLine1  string    `json:"addressLine1"`
	AddressLine2  string    `json:"addressLine2"`
	City          string    `json:"city"`
	Region        string    `json:"region"`
	PostalCode    string    `json:"postalCode"`
	Country       string    `json:"country"`
	Phone         string    `json:"phone"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type Level struct {
	VariantID  string    `json:"variantId"`
	LocationID string    `json:"locationId"`
	OnHand     int       `json:"onHand"`
	Committed  int       `json:"committed"`
	Incoming   int       `json:"incoming"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Adjustment struct {
	ID         string    `json:"id"`
	VariantID  string    `json:"variantId"`
	LocationID string    `json:"locationId"`
	Delta      int       `json:"delta"`
	Reason     string    `json:"reason"`
	Note       string    `json:"note"`
	AdminID    string    `json:"adminId"`
	CreatedAt  time.Time `json:"createdAt"`
}

// Product-level inventory view: variants × locations matrix, small enough to
// render in a single table on the product editor.
type ProductMatrix struct {
	ProductID string         `json:"productId"`
	Locations []MatrixLoc    `json:"locations"`
	Variants  []MatrixVariant `json:"variants"`
}

type MatrixLoc struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type MatrixVariant struct {
	ID        string          `json:"id"`
	SKU       string          `json:"sku"`
	Label     string          `json:"label"`
	Track     bool            `json:"trackInventory"`
	Levels    map[string]Cell `json:"levels"` // locationId → cell
	TotalOnHand int           `json:"totalOnHand"`
}

type Cell struct {
	OnHand    int `json:"onHand"`
	Committed int `json:"committed"`
	Incoming  int `json:"incoming"`
}

// Transfers ---------------------------------------------------------------

type Transfer struct {
	ID             string         `json:"id"`
	FromLocationID string         `json:"fromLocationId"`
	ToLocationID   string         `json:"toLocationId"`
	FromName       string         `json:"fromName"`
	ToName         string         `json:"toName"`
	Status         string         `json:"status"` // draft / in_transit / received / cancelled
	Note           string         `json:"note"`
	CreatedByID    string         `json:"createdById"`
	CreatedAt      time.Time      `json:"createdAt"`
	ShippedAt      *time.Time     `json:"shippedAt,omitempty"`
	ReceivedAt     *time.Time     `json:"receivedAt,omitempty"`
	Items          []TransferItem `json:"items"`
	TotalUnits     int            `json:"totalUnits"`
}

type TransferItem struct {
	VariantID   string `json:"variantId"`
	SKU         string `json:"sku"`
	Label       string `json:"label"`
	Quantity    int    `json:"quantity"`
}

// Valid reason codes for inventory_adjustments.reason.
var ValidReasons = map[string]bool{
	"received":   true,
	"damaged":    true,
	"theft":      true,
	"correction": true,
	"count":      true,
	"transfer":   true,
	"other":      true,
}

var ValidTransferStatuses = map[string]bool{
	"draft":      true,
	"in_transit": true,
	"received":   true,
	"cancelled":  true,
}
