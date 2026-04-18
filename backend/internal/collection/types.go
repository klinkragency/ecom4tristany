package collection

import "time"

type Collection struct {
	ID              string     `json:"id"`
	Handle          string     `json:"handle"`
	Title           string     `json:"title"`
	DescriptionHTML string     `json:"descriptionHtml"`
	ImageURL        string     `json:"imageUrl"`
	IsRulesBased    bool       `json:"isRulesBased"`
	MatchAll        bool       `json:"matchAll"`
	SortOrder       string     `json:"sortOrder"`
	SEOTitle        string     `json:"seoTitle"`
	SEODescription  string     `json:"seoDescription"`
	PublishedAt     *time.Time `json:"publishedAt,omitempty"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	Rules           []Rule     `json:"rules"`
}

type Rule struct {
	ID       string `json:"id"`
	Field    string `json:"field"`    // title / vendor / product_type / tag / price / inventory / status
	Operator string `json:"operator"` // equals / not_equals / contains / ... / greater_than / less_than / in_stock / out_of_stock
	Value    string `json:"value"`
	Position int    `json:"position"`
}

type ProductRef struct {
	ID              string `json:"id"`
	Handle          string `json:"handle"`
	Title           string `json:"title"`
	Status          string `json:"status"`
	MinPriceCents   int    `json:"minPriceCents"`
	MaxPriceCents   int    `json:"maxPriceCents"`
	PrimaryImageURL string `json:"primaryImageUrl"`
	Position        int    `json:"position"`
}

type ListItem struct {
	ID           string    `json:"id"`
	Handle       string    `json:"handle"`
	Title        string    `json:"title"`
	IsRulesBased bool      `json:"isRulesBased"`
	ProductCount int       `json:"productCount"`
	ImageURL     string    `json:"imageUrl"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ListPage struct {
	Items      []ListItem `json:"items"`
	NextCursor string     `json:"nextCursor,omitempty"`
}

// Valid values used for validation in handlers.
var (
	validFields = map[string]bool{
		"title": true, "vendor": true, "product_type": true, "tag": true,
		"price": true, "inventory": true, "status": true,
	}
	validOperators = map[string]bool{
		"equals": true, "not_equals": true, "contains": true, "not_contains": true,
		"starts_with": true, "ends_with": true, "greater_than": true, "less_than": true,
		"in_stock": true, "out_of_stock": true,
	}
	validSortOrders = map[string]bool{
		"manual": true, "best_selling": true,
		"price_asc": true, "price_desc": true,
		"alpha_asc": true, "alpha_desc": true, "created_desc": true,
	}
)
