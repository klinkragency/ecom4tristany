package collection

import (
	"fmt"
	"strconv"
	"strings"
)

// buildRuleSQL translates rules into a single SQL expression plus the matching
// args, to be spliced into "SELECT ... FROM products p WHERE {expr}".
// Returns "" if there are no rules (caller should treat as "match nothing").
// matchAll=true → AND, false → OR.
func buildRuleSQL(rules []Rule, matchAll bool, startArgIdx int) (string, []any, error) {
	if len(rules) == 0 {
		return "", nil, nil
	}
	var parts []string
	var args []any
	next := startArgIdx
	placeholder := func(v any) string {
		args = append(args, v)
		next++
		return "$" + strconv.Itoa(next)
	}

	for _, r := range rules {
		expr, err := singleRuleSQL(r, placeholder)
		if err != nil {
			return "", nil, err
		}
		if expr != "" {
			parts = append(parts, "("+expr+")")
		}
	}
	if len(parts) == 0 {
		return "", nil, nil
	}
	joiner := " OR "
	if matchAll {
		joiner = " AND "
	}
	return strings.Join(parts, joiner), args, nil
}

func singleRuleSQL(r Rule, ph func(any) string) (string, error) {
	switch r.Field {
	case "title", "vendor", "product_type":
		return textOp("p."+r.Field, r.Operator, r.Value, ph)
	case "status":
		switch r.Operator {
		case "equals":
			return "p.status = " + ph(r.Value), nil
		case "not_equals":
			return "p.status <> " + ph(r.Value), nil
		}
		return "", fmt.Errorf("operator %q invalid for status", r.Operator)

	case "tag":
		tagExists := "EXISTS (SELECT 1 FROM product_tags pt WHERE pt.product_id = p.id AND pt.tag = " + ph(r.Value) + ")"
		switch r.Operator {
		case "equals", "contains":
			return tagExists, nil
		case "not_equals", "not_contains":
			return "NOT " + tagExists, nil
		}
		return "", fmt.Errorf("operator %q invalid for tag", r.Operator)

	case "price":
		// Compare against the MIN variant price. Value is euros → convert to cents.
		euros, err := strconv.ParseFloat(strings.TrimSpace(r.Value), 64)
		if err != nil {
			return "", fmt.Errorf("price value %q is not a number", r.Value)
		}
		cents := int(euros * 100)
		priceExpr := "(SELECT MIN(price_cents) FROM variants WHERE product_id = p.id)"
		switch r.Operator {
		case "greater_than":
			return priceExpr + " > " + ph(cents), nil
		case "less_than":
			return priceExpr + " < " + ph(cents), nil
		case "equals":
			return priceExpr + " = " + ph(cents), nil
		case "not_equals":
			return priceExpr + " <> " + ph(cents), nil
		}
		return "", fmt.Errorf("operator %q invalid for price", r.Operator)

	case "inventory":
		// Stock is considered "in stock" if any variant has on_hand > 0 at any location.
		// Variants with track_inventory=false are always considered in stock.
		stockExpr := `EXISTS (
            SELECT 1 FROM variants v
            WHERE v.product_id = p.id AND (
                v.track_inventory = false OR EXISTS (
                    SELECT 1 FROM inventory_levels il
                    WHERE il.variant_id = v.id AND il.on_hand > 0
                )
            )
        )`
		switch r.Operator {
		case "in_stock":
			return stockExpr, nil
		case "out_of_stock":
			return "NOT " + stockExpr, nil
		}
		return "", fmt.Errorf("operator %q invalid for inventory", r.Operator)
	}
	return "", fmt.Errorf("unknown field %q", r.Field)
}

func textOp(col, op, value string, ph func(any) string) (string, error) {
	switch op {
	case "equals":
		return col + " = " + ph(value), nil
	case "not_equals":
		return col + " <> " + ph(value), nil
	case "contains":
		return col + " ILIKE " + ph("%"+escapeLike(value)+"%"), nil
	case "not_contains":
		return col + " NOT ILIKE " + ph("%"+escapeLike(value)+"%"), nil
	case "starts_with":
		return col + " ILIKE " + ph(escapeLike(value)+"%"), nil
	case "ends_with":
		return col + " ILIKE " + ph("%"+escapeLike(value)), nil
	}
	return "", fmt.Errorf("operator %q invalid for %s", op, col)
}

// escapeLike escapes the LIKE wildcards so user input matches literally.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
