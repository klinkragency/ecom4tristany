package customer

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/3mg/shop/backend/internal/auth"
	"github.com/3mg/shop/backend/internal/httpx"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// ─── DTOs ───────────────────────────────────────────────────────────────

type SegmentRule struct {
	ID       string `json:"id,omitempty"`
	Field    string `json:"field"`
	Operator string `json:"operator"`
	Value    string `json:"value"`
	Position int    `json:"position"`
}

type Segment struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Description string        `json:"description"`
	MatchAll    bool          `json:"matchAll"`
	Rules       []SegmentRule `json:"rules"`
	CreatedAt   time.Time     `json:"createdAt"`
	UpdatedAt   time.Time     `json:"updatedAt"`
	MemberCount int           `json:"memberCount"`
}

type SegmentInput struct {
	Name        string        `json:"name"`
	Description string        `json:"description"`
	MatchAll    bool          `json:"matchAll"`
	Rules       []SegmentRule `json:"rules"`
}

// ─── Whitelists (must mirror the CHECK constraints on customer_segment_rules) ──

var allowedFields = map[string]bool{
	"email": true, "first_name": true, "last_name": true,
	"total_spent": true, "order_count": true, "last_order_days": true,
	"tag": true, "marketing_consent": true, "country": true, "created_days": true,
}
var allowedOps = map[string]bool{
	"equals": true, "not_equals": true, "contains": true, "not_contains": true,
	"starts_with": true, "ends_with": true,
	"greater_than": true, "less_than": true,
	"is_true": true, "is_false": true,
	"is_null": true, "is_not_null": true,
}

// ─── Handlers ───────────────────────────────────────────────────────────

func (h *Handler) ListSegments(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
        SELECT s.id, s.name, s.description, s.match_all, s.created_at, s.updated_at
        FROM customer_segments s
        ORDER BY s.name
    `)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	defer rows.Close()
	out := []Segment{}
	for rows.Next() {
		var s Segment
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.MatchAll, &s.CreatedAt, &s.UpdatedAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		s.Rules = []SegmentRule{}
		out = append(out, s)
	}
	// Attach rules + counts in a second pass (small segment counts — fine).
	for i := range out {
		rules, err := loadRules(r.Context(), h, out[i].ID)
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "rules_error", err.Error())
			return
		}
		out[i].Rules = rules
		count, err := countMembers(r.Context(), h, out[i].MatchAll, rules)
		if err == nil {
			out[i].MemberCount = count
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"items": out})
}

func (h *Handler) GetSegment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, err := loadSegment(r.Context(), h, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "segment not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}
	if c, err := countMembers(r.Context(), h, s.MatchAll, s.Rules); err == nil {
		s.MemberCount = c
	}
	httpx.JSON(w, http.StatusOK, s)
}

func (h *Handler) CreateSegment(w http.ResponseWriter, r *http.Request) {
	var req SegmentInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}
	if err := validateRules(req.Rules); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_rule", err.Error())
		return
	}

	sess, _ := auth.SessionFromContext(r.Context())
	createdBy := ""
	if sess != nil && sess.UserID.Valid {
		createdBy = uuidString(sess.UserID)
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	var id string
	if err := tx.QueryRow(r.Context(), `
        INSERT INTO customer_segments (name, description, match_all, created_by)
        VALUES ($1, $2, $3, NULLIF($4, '')::uuid)
        RETURNING id
    `, req.Name, req.Description, req.MatchAll, createdBy).Scan(&id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "insert_error", err.Error())
		return
	}
	if err := writeRules(r.Context(), tx, id, req.Rules); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "rules_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	s, err := loadSegment(r.Context(), h, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusCreated, s)
}

func (h *Handler) UpdateSegment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req SegmentInput
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_body", err.Error())
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		httpx.Error(w, http.StatusBadRequest, "missing_name", "name required")
		return
	}
	if err := validateRules(req.Rules); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid_rule", err.Error())
		return
	}

	tx, err := h.db.Begin(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "tx_error", err.Error())
		return
	}
	defer tx.Rollback(r.Context())

	res, err := tx.Exec(r.Context(), `
        UPDATE customer_segments SET name = $1, description = $2, match_all = $3, updated_at = now()
        WHERE id = $4
    `, req.Name, req.Description, req.MatchAll, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "segment not found")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`DELETE FROM customer_segment_rules WHERE segment_id = $1`, id); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "clear_rules_error", err.Error())
		return
	}
	if err := writeRules(r.Context(), tx, id, req.Rules); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "rules_error", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "commit_error", err.Error())
		return
	}

	s, err := loadSegment(r.Context(), h, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "load_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, s)
}

func (h *Handler) DeleteSegment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	res, err := h.db.Exec(r.Context(), `DELETE FROM customer_segments WHERE id = $1`, id)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_error", err.Error())
		return
	}
	if res.RowsAffected() == 0 {
		httpx.Error(w, http.StatusNotFound, "not_found", "segment not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PreviewSegment returns the first 100 matching customers (admin UI preview).
func (h *Handler) PreviewSegment(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	s, err := loadSegment(r.Context(), h, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.Error(w, http.StatusNotFound, "not_found", "segment not found")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
		return
	}

	clause, args, err := buildSegmentWhere(s.MatchAll, s.Rules)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "rule_build_error", err.Error())
		return
	}
	sql := `
        SELECT c.id, c.email, c.first_name, c.last_name, c.phone, c.created_at,
               COALESCE((SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS oc,
               COALESCE((SELECT SUM(total_cents) FROM orders WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded')), 0) AS spent,
               (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) AS last_order_at
        FROM customers c
        WHERE ` + clause + `
        ORDER BY c.created_at DESC
        LIMIT 100`
	rows, err := h.db.Query(r.Context(), sql, args...)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_error", err.Error())
		return
	}
	defer rows.Close()
	items := []AdminListItem{}
	for rows.Next() {
		var it AdminListItem
		if err := rows.Scan(&it.ID, &it.Email, &it.FirstName, &it.LastName, &it.Phone,
			&it.CreatedAt, &it.OrderCount, &it.TotalSpentCents, &it.LastOrderAt); err != nil {
			httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
			return
		}
		it.Currency = "EUR"
		it.Tags = []string{}
		items = append(items, it)
	}
	count, _ := countMembers(r.Context(), h, s.MatchAll, s.Rules)
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": count,
	})
}

// ─── Helpers ────────────────────────────────────────────────────────────

func loadSegment(ctx context.Context, h *Handler, id string) (*Segment, error) {
	var s Segment
	err := h.db.QueryRow(ctx, `
        SELECT id, name, description, match_all, created_at, updated_at
        FROM customer_segments WHERE id = $1
    `, id).Scan(&s.ID, &s.Name, &s.Description, &s.MatchAll, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	rules, err := loadRules(ctx, h, id)
	if err != nil {
		return nil, err
	}
	s.Rules = rules
	return &s, nil
}

func loadRules(ctx context.Context, h *Handler, segmentID string) ([]SegmentRule, error) {
	rows, err := h.db.Query(ctx, `
        SELECT id, field, operator, value, position
        FROM customer_segment_rules
        WHERE segment_id = $1
        ORDER BY position, id
    `, segmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SegmentRule{}
	for rows.Next() {
		var r SegmentRule
		if err := rows.Scan(&r.ID, &r.Field, &r.Operator, &r.Value, &r.Position); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func writeRules(ctx context.Context, tx pgx.Tx, segmentID string, rules []SegmentRule) error {
	for i, r := range rules {
		pos := r.Position
		if pos == 0 {
			pos = i
		}
		if _, err := tx.Exec(ctx, `
            INSERT INTO customer_segment_rules (segment_id, field, operator, value, position)
            VALUES ($1, $2, $3, $4, $5)
        `, segmentID, r.Field, r.Operator, r.Value, pos); err != nil {
			return err
		}
	}
	return nil
}

func validateRules(rules []SegmentRule) error {
	for i, r := range rules {
		if !allowedFields[r.Field] {
			return fmt.Errorf("rule %d: unknown field %q", i, r.Field)
		}
		if !allowedOps[r.Operator] {
			return fmt.Errorf("rule %d: unknown operator %q", i, r.Operator)
		}
		// Numeric fields: require a parseable number for value-based operators.
		if isNumericField(r.Field) && needsValue(r.Operator) {
			if _, err := strconv.Atoi(strings.TrimSpace(r.Value)); err != nil {
				return fmt.Errorf("rule %d: %s requires an integer value", i, r.Field)
			}
		}
	}
	return nil
}

// countMembers runs a COUNT(*) using the same WHERE clause as the preview.
func countMembers(ctx context.Context, h *Handler, matchAll bool, rules []SegmentRule) (int, error) {
	clause, args, err := buildSegmentWhere(matchAll, rules)
	if err != nil {
		return 0, err
	}
	var n int
	err = h.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM customers c WHERE `+clause, args...,
	).Scan(&n)
	return n, err
}

// buildSegmentWhere renders the rule set into a parameterised SQL WHERE clause
// over the `customers c` alias. Values are always bound, never interpolated.
//
// Field → SQL mapping:
//   email / first_name / last_name  → c.<col>             (text)
//   marketing_consent               → c.marketing_consent (bool)
//   country  → lateral lookup on default address OR any address
//   tag      → EXISTS on customer_tags
//   total_spent        → paid order SUM
//   order_count        → paid order COUNT
//   last_order_days    → now() - MAX(orders.created_at) in days
//   created_days       → now() - c.created_at in days
func buildSegmentWhere(matchAll bool, rules []SegmentRule) (string, []any, error) {
	if len(rules) == 0 {
		return "TRUE", nil, nil
	}
	var parts []string
	var args []any
	next := func(v any) string { args = append(args, v); return "$" + strconv.Itoa(len(args)) }

	for _, r := range rules {
		frag, err := renderRule(r, next)
		if err != nil {
			return "", nil, err
		}
		parts = append(parts, "("+frag+")")
	}
	joiner := " OR "
	if matchAll {
		joiner = " AND "
	}
	return strings.Join(parts, joiner), args, nil
}

func renderRule(r SegmentRule, next func(any) string) (string, error) {
	if !allowedFields[r.Field] {
		return "", fmt.Errorf("unknown field: %s", r.Field)
	}
	if !allowedOps[r.Operator] {
		return "", fmt.Errorf("unknown operator: %s", r.Operator)
	}

	switch r.Field {
	case "email", "first_name", "last_name":
		return textRule("c."+r.Field, r.Operator, r.Value, next), nil
	case "marketing_consent":
		return boolRule("c.marketing_consent", r.Operator), nil
	case "country":
		// Any address for this customer matches.
		return existsRule(
			`EXISTS (SELECT 1 FROM customer_addresses ca WHERE ca.customer_id = c.id AND `+
				textRule("ca.country", r.Operator, r.Value, next)+`)`,
			r.Operator,
		), nil
	case "tag":
		// tag equals / contains translates to EXISTS on the join table.
		return tagRule(r.Operator, r.Value, next), nil
	case "total_spent":
		expr := `(SELECT COALESCE(SUM(total_cents), 0) FROM orders
                   WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded'))`
		return numericRule(expr, r.Operator, r.Value, next)
	case "order_count":
		expr := `(SELECT COUNT(*) FROM orders
                   WHERE customer_id = c.id AND financial_status IN ('paid','partially_refunded','refunded'))`
		return numericRule(expr, r.Operator, r.Value, next)
	case "last_order_days":
		// Days since last order. is_null means never ordered.
		expr := `(EXTRACT(DAY FROM now() - (SELECT MAX(created_at) FROM orders WHERE customer_id = c.id)))`
		switch r.Operator {
		case "is_null":
			return `(SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) IS NULL`, nil
		case "is_not_null":
			return `(SELECT MAX(created_at) FROM orders WHERE customer_id = c.id) IS NOT NULL`, nil
		}
		return numericRule(expr, r.Operator, r.Value, next)
	case "created_days":
		expr := `EXTRACT(DAY FROM now() - c.created_at)`
		return numericRule(expr, r.Operator, r.Value, next)
	}
	return "", fmt.Errorf("field not handled: %s", r.Field)
}

func textRule(col, op, val string, next func(any) string) string {
	switch op {
	case "equals":
		return col + " = " + next(val)
	case "not_equals":
		return col + " <> " + next(val)
	case "contains":
		return col + " ILIKE " + next("%"+val+"%")
	case "not_contains":
		return col + " NOT ILIKE " + next("%"+val+"%")
	case "starts_with":
		return col + " ILIKE " + next(val+"%")
	case "ends_with":
		return col + " ILIKE " + next("%"+val)
	case "is_null":
		return col + " IS NULL OR " + col + " = ''"
	case "is_not_null":
		return col + " IS NOT NULL AND " + col + " <> ''"
	}
	return "FALSE"
}

func boolRule(col, op string) string {
	switch op {
	case "is_true", "equals":
		return col + " = true"
	case "is_false", "not_equals":
		return col + " = false"
	}
	return "FALSE"
}

func numericRule(expr, op, val string, next func(any) string) (string, error) {
	switch op {
	case "is_null":
		return expr + " IS NULL", nil
	case "is_not_null":
		return expr + " IS NOT NULL", nil
	}
	n, err := strconv.Atoi(strings.TrimSpace(val))
	if err != nil {
		return "", fmt.Errorf("%s requires integer: %w", op, err)
	}
	switch op {
	case "equals":
		return expr + " = " + next(n), nil
	case "not_equals":
		return expr + " <> " + next(n), nil
	case "greater_than":
		return expr + " > " + next(n), nil
	case "less_than":
		return expr + " < " + next(n), nil
	}
	return "", fmt.Errorf("operator %s not valid for numeric field", op)
}

func tagRule(op, val string, next func(any) string) string {
	base := `SELECT 1 FROM customer_tags ct WHERE ct.customer_id = c.id`
	switch op {
	case "equals":
		return `EXISTS (` + base + ` AND ct.tag = ` + next(val) + `)`
	case "not_equals":
		return `NOT EXISTS (` + base + ` AND ct.tag = ` + next(val) + `)`
	case "contains":
		return `EXISTS (` + base + ` AND ct.tag ILIKE ` + next("%"+val+"%") + `)`
	case "not_contains":
		return `NOT EXISTS (` + base + ` AND ct.tag ILIKE ` + next("%"+val+"%") + `)`
	case "is_null":
		return `NOT EXISTS (` + base + `)`
	case "is_not_null":
		return `EXISTS (` + base + `)`
	}
	return "FALSE"
}

func existsRule(inner, op string) string {
	// Inner already encodes its own (not_)contains/equals semantics; wrap for
	// null-style operators.
	switch op {
	case "is_null":
		return `NOT ` + inner
	}
	return inner
}

func isNumericField(f string) bool {
	switch f {
	case "total_spent", "order_count", "last_order_days", "created_days":
		return true
	}
	return false
}

func needsValue(op string) bool {
	switch op {
	case "is_null", "is_not_null", "is_true", "is_false":
		return false
	}
	return true
}
