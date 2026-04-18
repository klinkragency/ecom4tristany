package product

import "time"

type Product struct {
	ID              string     `json:"id"`
	Handle          string     `json:"handle"`
	Title           string     `json:"title"`
	DescriptionHTML string     `json:"descriptionHtml"`
	Status          string     `json:"status"`
	Vendor          string     `json:"vendor"`
	ProductType     string     `json:"productType"`
	TaxStatus       string     `json:"taxStatus"`
	WeightGrams     int        `json:"weightGrams"`
	HSCode          string     `json:"hsCode"`
	SEOTitle        string     `json:"seoTitle"`
	SEODescription  string     `json:"seoDescription"`
	PublishedAt     *time.Time `json:"publishedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	Tags            []string   `json:"tags"`
	Options         []Option   `json:"options"`
	Variants        []Variant  `json:"variants"`
	Media           []Media    `json:"media"`
}

type Option struct {
	ID       string        `json:"id"`
	Position int           `json:"position"`
	Name     string        `json:"name"`
	Values   []OptionValue `json:"values"`
}

type OptionValue struct {
	ID       string `json:"id"`
	Position int    `json:"position"`
	Value    string `json:"value"`
}

type Variant struct {
	ID                 string            `json:"id"`
	ProductID          string            `json:"productId"`
	SKU                string            `json:"sku"`
	Barcode            string            `json:"barcode"`
	PriceCents         int               `json:"priceCents"`
	CompareAtCents     *int              `json:"compareAtCents,omitempty"`
	CostCents          *int              `json:"costCents,omitempty"`
	WeightGrams        int               `json:"weightGrams"`
	Position           int               `json:"position"`
	TrackInventory     bool              `json:"trackInventory"`
	ContinueSellingOOS bool              `json:"continueSellingOos"`
	// OptionValues maps optionId -> valueId
	OptionValues       map[string]string `json:"optionValues"`
}

type Media struct {
	ID        string  `json:"id"`
	ProductID string  `json:"productId"`
	VariantID *string `json:"variantId,omitempty"`
	Kind      string  `json:"kind"`
	ObjectKey string  `json:"objectKey"`
	URL       string  `json:"url"`
	Alt       string  `json:"alt"`
	Width     *int    `json:"width,omitempty"`
	Height    *int    `json:"height,omitempty"`
	Bytes     *int    `json:"bytes,omitempty"`
	Mime      string  `json:"mime"`
	Position  int     `json:"position"`
}

type ListItem struct {
	ID               string    `json:"id"`
	Handle           string    `json:"handle"`
	Title            string    `json:"title"`
	Status           string    `json:"status"`
	Vendor           string    `json:"vendor"`
	ProductType      string    `json:"productType"`
	UpdatedAt        time.Time `json:"updatedAt"`
	VariantCount     int       `json:"variantCount"`
	MinPriceCents    int       `json:"minPriceCents"`
	MaxPriceCents    int       `json:"maxPriceCents"`
	PrimaryImageURL  string    `json:"primaryImageUrl"`
}

type ListPage struct {
	Items      []ListItem `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}
