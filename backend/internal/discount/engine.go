// Package discount is the promotions engine. It evaluates which discounts
// apply to a given cart and returns a per-line breakdown the checkout uses
// to build the order totals.
//
// Stacking policy (deliberate, to keep UX predictable):
//   - A cart can carry at most ONE code-entered discount.
//   - Automatic discounts (code IS NULL) apply in addition to the code.
//   - Free shipping always stacks (it doesn't touch line totals).
//   - Within the "amount off" family, the largest single discount wins per
//     line (no stacking several % off on the same item).
//
// The engine is pure: given the cart + discount rows, it returns the
// breakdown. Persistence (carts.discount_code, discount_usages) is the
// caller's job.
package discount

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/customer"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ─── Inputs ─────────────────────────────────────────────────────────────

// CartLine is the minimum the engine needs from a line item. The checkout
// builds these from its own cart query so we don't pull the cart package here.
type CartLine struct {
	LineID         string
	VariantID      string
	ProductID      string
	UnitPriceCents int
	Quantity       int
}

type Input struct {
	Lines          []CartLine
	SubtotalCents  int
	ShippingCents  int
	CustomerID     *string   // nil for guest
	Code           string    // buyer-entered code (case-insensitive); "" for none
	EvaluatedAt    time.Time // now(); override in tests
}

// ─── Outputs ────────────────────────────────────────────────────────────

// LineDiscount is how much to subtract from a single cart line. Checkout
// uses these to compute final line totals + aggregate discount_cents.
type LineDiscount struct {
	LineID     string
	DiscountID string
	Code       string
	Title      string
	Cents      int
	// Which kind produced this deduction — purely informational.
	Source string // 'percentage'|'amount'|'bogo'
}

// Result is what the engine returns per evaluation.
type Result struct {
	LineDiscounts    []LineDiscount
	ShippingDiscount int    // cents off the shipping component
	FreeShipping     bool   // convenience flag when shipping is zero-ed
	// Which discounts actually applied (for the usage ledger).
	AppliedDiscountIDs []string
	// Error describing why a *code* failed — surfaced to the cart UI. Never
	// set for silent/automatic failures (those just don't apply).
	CodeError string
	// Snapshot used by orders.discount_code / orders.discount_title on commit.
	AppliedCode  string
	AppliedTitle string
}

// TotalOff returns the total cents deducted across all line discounts.
func (r *Result) TotalOff() int {
	total := 0
	for _, l := range r.LineDiscounts {
		total += l.Cents
	}
	return total
}

// ─── DB projection of a discount row ────────────────────────────────────

type discountRow struct {
	ID                      string
	Code                    *string
	Title                   string
	Kind                    string
	ValuePercent            *float64
	ValueCents              *int
	Scope                   string
	Eligibility             string
	UsageLimit              *int
	UsageLimitPerCustomer   *int
	MinSubtotalCents        int
	UsageCount              int
	BOGOBuyQuantity         *int
	BOGOGetQuantity         *int
	BOGOGetDiscountPercent  *float64
	BOGOBuyScope            *string
	BOGOGetScope            *string
	Active                  bool
	StartsAt                *time.Time
	EndsAt                  *time.Time
}

// ─── Evaluation ─────────────────────────────────────────────────────────

// Evaluate runs the engine against the DB. Returns a Result explaining
// what applied. Called from both the cart-preview endpoint and the
// checkout/Init flow.
func Evaluate(ctx context.Context, db *pgxpool.Pool, in Input) (*Result, error) {
	res := &Result{LineDiscounts: []LineDiscount{}}

	// 1) Resolve the code discount (if any).
	var codeDisc *discountRow
	if strings.TrimSpace(in.Code) != "" {
		d, err := fetchByCode(ctx, db, in.Code)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				res.CodeError = "Invalid code"
				// Don't abort — automatic discounts still apply.
			} else {
				return nil, err
			}
		}
		if d != nil {
			if errMsg := checkEligibility(ctx, db, d, in); errMsg != "" {
				res.CodeError = errMsg
			} else {
				codeDisc = d
				res.AppliedCode = derefStr(d.Code)
				res.AppliedTitle = d.Title
			}
		}
	}

	// 2) Load automatic discounts (code IS NULL and active, within date window).
	autos, err := fetchActiveAutomatic(ctx, db, in.EvaluatedAt)
	if err != nil {
		return nil, err
	}

	// Filter automatics by eligibility + min subtotal.
	autoEligible := make([]*discountRow, 0, len(autos))
	for _, d := range autos {
		if checkEligibility(ctx, db, d, in) == "" {
			autoEligible = append(autoEligible, d)
		}
	}

	// 3) Apply each qualifying discount. Order: code first (if any), then autos.
	//    For each line, only the *largest* cents-off from the pile survives —
	//    except free_shipping which only affects the shipping component and is
	//    therefore always additive.
	//
	//    This "best single line discount wins" keeps stacking behaviour simple:
	//    a customer can't stack "10% off" + "€5 off" + BOGO on the same T-shirt,
	//    they get whichever is biggest.
	perLineBest := map[string]LineDiscount{}
	applied := map[string]bool{}
	allCandidates := []*discountRow{}
	if codeDisc != nil {
		allCandidates = append(allCandidates, codeDisc)
	}
	allCandidates = append(allCandidates, autoEligible...)

	for _, d := range allCandidates {
		switch d.Kind {
		case "free_shipping":
			if in.ShippingCents > 0 {
				res.ShippingDiscount = in.ShippingCents
				res.FreeShipping = true
				applied[d.ID] = true
			} else {
				applied[d.ID] = true // still considered used
			}
		case "percentage", "amount":
			targetLines, err := resolveTargetLines(ctx, db, d, in.Lines, "apply")
			if err != nil {
				return nil, err
			}
			if len(targetLines) == 0 {
				continue
			}
			// For 'amount' off on a multi-line scope, distribute proportionally.
			if d.Kind == "amount" && d.ValueCents != nil && len(targetLines) > 1 {
				sum := 0
				for _, l := range targetLines {
					sum += l.UnitPriceCents * l.Quantity
				}
				if sum == 0 {
					continue
				}
				remaining := *d.ValueCents
				if remaining > sum {
					remaining = sum
				}
				for i, l := range targetLines {
					share := 0
					if i == len(targetLines)-1 {
						share = remaining
					} else {
						share = *d.ValueCents * (l.UnitPriceCents * l.Quantity) / sum
						remaining -= share
					}
					if share <= 0 {
						continue
					}
					upgradeLineBest(perLineBest, LineDiscount{
						LineID:     l.LineID,
						DiscountID: d.ID,
						Code:       derefStr(d.Code),
						Title:      d.Title,
						Cents:      share,
						Source:     "amount",
					})
					applied[d.ID] = true
				}
				continue
			}
			for _, l := range targetLines {
				cents := perLineCentsOff(d, l)
				if cents <= 0 {
					continue
				}
				lineTotal := l.UnitPriceCents * l.Quantity
				if cents > lineTotal {
					cents = lineTotal
				}
				upgradeLineBest(perLineBest, LineDiscount{
					LineID:     l.LineID,
					DiscountID: d.ID,
					Code:       derefStr(d.Code),
					Title:      d.Title,
					Cents:      cents,
					Source:     d.Kind,
				})
				applied[d.ID] = true
			}
		case "bogo":
			buyLines, err := resolveTargetLines(ctx, db, d, in.Lines, "buy")
			if err != nil {
				return nil, err
			}
			getLines, err := resolveTargetLines(ctx, db, d, in.Lines, "get")
			if err != nil {
				return nil, err
			}
			bogoLineDiscounts, ok := applyBOGO(d, buyLines, getLines)
			if !ok {
				continue
			}
			for _, ld := range bogoLineDiscounts {
				upgradeLineBest(perLineBest, ld)
			}
			applied[d.ID] = true
		}
	}

	for _, ld := range perLineBest {
		res.LineDiscounts = append(res.LineDiscounts, ld)
	}
	for id := range applied {
		res.AppliedDiscountIDs = append(res.AppliedDiscountIDs, id)
	}
	return res, nil
}

// upgradeLineBest keeps the larger of the incoming vs existing LineDiscount
// for a given line ID — so the best single discount wins per line.
func upgradeLineBest(m map[string]LineDiscount, incoming LineDiscount) {
	existing, ok := m[incoming.LineID]
	if !ok || incoming.Cents > existing.Cents {
		m[incoming.LineID] = incoming
	}
}

// perLineCentsOff computes the raw cents-off for a single line under a
// percentage or amount (single-line) discount.
func perLineCentsOff(d *discountRow, l CartLine) int {
	lineTotal := l.UnitPriceCents * l.Quantity
	switch d.Kind {
	case "percentage":
		if d.ValuePercent == nil {
			return 0
		}
		return int(float64(lineTotal) * *d.ValuePercent / 100.0)
	case "amount":
		if d.ValueCents == nil {
			return 0
		}
		return *d.ValueCents
	}
	return 0
}

// applyBOGO implements the classic "buy X of A, get Y of B at Z% off" math.
// Returns per-get-line discount rows + a flag indicating whether the cart
// meets the minimum buy threshold.
//
// Logic:
//   1. Sum the quantity across all "buy" lines.
//   2. Let times = floor(totalBuy / x). If 0, BOGO doesn't apply.
//   3. Apply discount to Y*times units drawn from the "get" lines, starting
//      with the cheapest units first — that way "get free" promotions don't
//      accidentally pick the most expensive item and hurt margins.
func applyBOGO(d *discountRow, buyLines, getLines []CartLine) ([]LineDiscount, bool) {
	if d.BOGOBuyQuantity == nil || d.BOGOGetQuantity == nil || d.BOGOGetDiscountPercent == nil {
		return nil, false
	}
	if *d.BOGOBuyQuantity <= 0 || *d.BOGOGetQuantity <= 0 {
		return nil, false
	}
	buyQty := 0
	for _, l := range buyLines {
		buyQty += l.Quantity
	}
	times := buyQty / *d.BOGOBuyQuantity
	if times <= 0 {
		return nil, false
	}
	unitsToDiscount := times * *d.BOGOGetQuantity

	// If buy and get lists overlap, we must not discount units that were
	// counted as "buys" — cap at remaining buy quantity.
	remainingByLine := map[string]int{}
	for _, l := range getLines {
		remainingByLine[l.LineID] = l.Quantity
	}

	// Sort get-lines cheapest first.
	sorted := append([]CartLine(nil), getLines...)
	for i := 0; i < len(sorted); i++ {
		for j := i + 1; j < len(sorted); j++ {
			if sorted[j].UnitPriceCents < sorted[i].UnitPriceCents {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}

	var out []LineDiscount
	left := unitsToDiscount
	for _, l := range sorted {
		if left <= 0 {
			break
		}
		avail := remainingByLine[l.LineID]
		take := avail
		if take > left {
			take = left
		}
		if take <= 0 {
			continue
		}
		cents := int(float64(l.UnitPriceCents*take) * *d.BOGOGetDiscountPercent / 100.0)
		if cents <= 0 {
			continue
		}
		out = append(out, LineDiscount{
			LineID:     l.LineID,
			DiscountID: d.ID,
			Code:       derefStr(d.Code),
			Title:      d.Title,
			Cents:      cents,
			Source:     "bogo",
		})
		left -= take
	}
	return out, len(out) > 0
}

// resolveTargetLines returns which cart lines are eligible for a given
// discount/list combination. "list" is one of 'apply' | 'buy' | 'get'.
//   - For scope='all', every line qualifies (only valid for list='apply').
//   - For scope='products', the line's product_id must be linked via
//     discount_products with the matching list.
//   - For scope='collections', the line's product must be a member of at
//     least one linked collection with the matching list.
func resolveTargetLines(ctx context.Context, db *pgxpool.Pool, d *discountRow, lines []CartLine, list string) ([]CartLine, error) {
	effectiveScope := d.Scope
	if list == "buy" && d.BOGOBuyScope != nil {
		effectiveScope = *d.BOGOBuyScope
	}
	if list == "get" && d.BOGOGetScope != nil {
		effectiveScope = *d.BOGOGetScope
	}

	if effectiveScope == "all" {
		return lines, nil
	}
	var allowed map[string]bool
	var err error
	switch effectiveScope {
	case "products":
		allowed, err = fetchDiscountProducts(ctx, db, d.ID, list)
	case "collections":
		allowed, err = fetchDiscountCollectionProducts(ctx, db, d.ID, list)
	default:
		return nil, fmt.Errorf("unknown scope: %s", effectiveScope)
	}
	if err != nil {
		return nil, err
	}
	out := make([]CartLine, 0, len(lines))
	for _, l := range lines {
		if allowed[l.ProductID] {
			out = append(out, l)
		}
	}
	return out, nil
}

// checkEligibility returns "" on success, or a human message if the buyer's
// cart/identity doesn't meet the discount's rules. Returned messages are
// safe to show to the buyer (no sensitive info).
func checkEligibility(ctx context.Context, db *pgxpool.Pool, d *discountRow, in Input) string {
	now := in.EvaluatedAt
	if now.IsZero() {
		now = time.Now()
	}
	if !d.Active {
		return "This code is no longer active"
	}
	if d.StartsAt != nil && now.Before(*d.StartsAt) {
		return "This code is not yet active"
	}
	if d.EndsAt != nil && now.After(*d.EndsAt) {
		return "This code has expired"
	}
	if d.MinSubtotalCents > 0 && in.SubtotalCents < d.MinSubtotalCents {
		return fmt.Sprintf("Spend at least %s to use this code",
			formatCents(d.MinSubtotalCents))
	}
	if d.UsageLimit != nil && d.UsageCount >= *d.UsageLimit {
		return "This code has reached its usage limit"
	}
	if d.UsageLimitPerCustomer != nil && in.CustomerID != nil {
		var used int
		_ = db.QueryRow(ctx,
			`SELECT COUNT(*) FROM discount_usages WHERE discount_id = $1 AND customer_id = $2`,
			d.ID, *in.CustomerID,
		).Scan(&used)
		if used >= *d.UsageLimitPerCustomer {
			return "You've already used this code the maximum number of times"
		}
	}
	if d.Eligibility == "segments" {
		if in.CustomerID == nil {
			return "This code is for signed-in customers only"
		}
		ok, err := customerInAnySegment(ctx, db, d.ID, *in.CustomerID)
		if err != nil {
			return "Could not verify eligibility"
		}
		if !ok {
			return "You're not eligible for this code"
		}
	}
	return ""
}

// ─── DB loaders ─────────────────────────────────────────────────────────

func fetchByCode(ctx context.Context, db *pgxpool.Pool, code string) (*discountRow, error) {
	var d discountRow
	err := db.QueryRow(ctx, `
        SELECT id, code, title, kind, value_percent, value_cents, scope,
               eligibility, usage_limit, usage_limit_per_customer,
               min_subtotal_cents, usage_count,
               bogo_buy_quantity, bogo_get_quantity, bogo_get_discount_percent,
               bogo_buy_scope, bogo_get_scope,
               active, starts_at, ends_at
        FROM discounts WHERE code = $1
    `, code).Scan(
		&d.ID, &d.Code, &d.Title, &d.Kind, &d.ValuePercent, &d.ValueCents, &d.Scope,
		&d.Eligibility, &d.UsageLimit, &d.UsageLimitPerCustomer,
		&d.MinSubtotalCents, &d.UsageCount,
		&d.BOGOBuyQuantity, &d.BOGOGetQuantity, &d.BOGOGetDiscountPercent,
		&d.BOGOBuyScope, &d.BOGOGetScope,
		&d.Active, &d.StartsAt, &d.EndsAt,
	)
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func fetchActiveAutomatic(ctx context.Context, db *pgxpool.Pool, now time.Time) ([]*discountRow, error) {
	rows, err := db.Query(ctx, `
        SELECT id, code, title, kind, value_percent, value_cents, scope,
               eligibility, usage_limit, usage_limit_per_customer,
               min_subtotal_cents, usage_count,
               bogo_buy_quantity, bogo_get_quantity, bogo_get_discount_percent,
               bogo_buy_scope, bogo_get_scope,
               active, starts_at, ends_at
        FROM discounts
        WHERE code IS NULL AND active = true
          AND (starts_at IS NULL OR starts_at <= $1)
          AND (ends_at   IS NULL OR ends_at   >= $1)
        ORDER BY created_at
    `, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*discountRow
	for rows.Next() {
		var d discountRow
		if err := rows.Scan(
			&d.ID, &d.Code, &d.Title, &d.Kind, &d.ValuePercent, &d.ValueCents, &d.Scope,
			&d.Eligibility, &d.UsageLimit, &d.UsageLimitPerCustomer,
			&d.MinSubtotalCents, &d.UsageCount,
			&d.BOGOBuyQuantity, &d.BOGOGetQuantity, &d.BOGOGetDiscountPercent,
			&d.BOGOBuyScope, &d.BOGOGetScope,
			&d.Active, &d.StartsAt, &d.EndsAt,
		); err != nil {
			return nil, err
		}
		out = append(out, &d)
	}
	return out, nil
}

func fetchDiscountProducts(ctx context.Context, db *pgxpool.Pool, discountID, list string) (map[string]bool, error) {
	rows, err := db.Query(ctx,
		`SELECT product_id FROM discount_products WHERE discount_id = $1 AND list = $2`,
		discountID, list,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = true
	}
	return out, nil
}

func fetchDiscountCollectionProducts(ctx context.Context, db *pgxpool.Pool, discountID, list string) (map[string]bool, error) {
	rows, err := db.Query(ctx, `
        SELECT DISTINCT cp.product_id
        FROM discount_collections dc
        JOIN collection_products cp ON cp.collection_id = dc.collection_id
        WHERE dc.discount_id = $1 AND dc.list = $2
    `, discountID, list)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		out[p] = true
	}
	return out, nil
}

// customerInAnySegment returns true if the customer belongs to at least one
// of the segments this discount is restricted to. Delegates to
// customer.CheckSegmentMembership so the same rule evaluator powers both the
// admin preview and the eligibility check.
func customerInAnySegment(ctx context.Context, db *pgxpool.Pool, discountID, customerID string) (bool, error) {
	rows, err := db.Query(ctx,
		`SELECT segment_id FROM discount_segments WHERE discount_id = $1`, discountID,
	)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	var segIDs []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return false, err
		}
		segIDs = append(segIDs, s)
	}
	if len(segIDs) == 0 {
		return false, nil
	}
	for _, segID := range segIDs {
		ok, err := customer.CheckSegmentMembership(ctx, db, segID, customerID)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

// ─── Small helpers ──────────────────────────────────────────────────────

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func formatCents(c int) string {
	euros := c / 100
	rem := c % 100
	return fmt.Sprintf("%d.%02d €", euros, rem)
}
