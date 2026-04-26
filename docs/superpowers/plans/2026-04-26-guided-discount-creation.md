# Guided Discount Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the monolithic `DiscountForm.tsx` with a Shopify-style guided experience: a type-picker modal followed by a tailored single-page form per discount type, with live customer preview, auto-generated codes, friendly validation, and data-driven suggestions.

**Architecture:** Four top-level forms (one per type) compose shared section primitives (Method, Value, Eligibility, Limits, Schedule, Active) that live in `admin/app/(dash)/discounts/_forms/shared/`. Pure utilities (validation, preview math, helpers, types) are unit-tested with `bun test`. UI components have no unit-test infra in this repo — they're verified via the Playwright e2e rewrite at the end. Backend adds one `Suggestions` endpoint with Go tests.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind v4, TypeScript strict, Bun (runtime + test), Go 1.25 (chi + pgx), Playwright (e2e).

**Spec:** [docs/superpowers/specs/2026-04-26-guided-discount-creation-design.md](../specs/2026-04-26-guided-discount-creation-design.md)

---

## File structure

```
backend/internal/discount/
├── admin.go                                     # MODIFY: append Suggestions handler
└── admin_test.go                                # CREATE if missing, add Suggestions tests

backend/internal/server/router.go                # MODIFY: wire /discounts/suggestions route

admin/app/(dash)/discounts/
├── page.tsx                                     # MODIFY: open modal on Create button
├── DiscountTypeModal.tsx                        # CREATE
├── new/
│   ├── page.tsx                                 # CREATE: redirect helper
│   └── [type]/page.tsx                          # CREATE: type slug → form resolver
├── [id]/page.tsx                                # REWRITE: use new forms
├── DiscountForm.tsx                             # DELETE at end
└── _forms/                                      # CREATE
    ├── shared/
    │   ├── types.ts
    │   ├── types.test.ts
    │   ├── helpers.ts
    │   ├── helpers.test.ts
    │   ├── validation.ts
    │   ├── validation.test.ts
    │   ├── preview-math.ts
    │   ├── preview-math.test.ts
    │   ├── illustrations.tsx
    │   ├── FieldHint.tsx
    │   ├── DataSuggestion.tsx
    │   ├── PageLayout.tsx
    │   ├── Header.tsx
    │   ├── MethodSection.tsx
    │   ├── ValueSection.tsx
    │   ├── AppliesToProductsCollectionsSection.tsx
    │   ├── EligibilitySection.tsx
    │   ├── LimitsSection.tsx
    │   ├── ScheduleSection.tsx
    │   ├── ActiveSection.tsx
    │   ├── BogoBuySection.tsx
    │   ├── BogoGetSection.tsx
    │   └── LivePreview.tsx
    ├── AmountOffOrderForm.tsx
    ├── AmountOffProductsForm.tsx
    ├── BuyXGetYForm.tsx
    └── FreeShippingForm.tsx

admin/app/globals.css                            # MODIFY: add --color-accent-illustration token

e2e/tests/phase6-discounts.spec.ts               # REWRITE
```

Type-URL ↔ payload mapping (from spec §4):

| URL slug | `kind` | `scope` |
|---|---|---|
| `amount-off-order` | `percentage` or `amount` | `all` |
| `amount-off-products` | `percentage` or `amount` | `products` or `collections` |
| `buy-x-get-y` | `bogo` | `all` |
| `free-shipping` | `free_shipping` | `all` |

---

## Task 1: Backend `Suggestions` endpoint

**Files:**
- Modify: `backend/internal/discount/admin.go` (append handler)
- Create: `backend/internal/discount/admin_test.go`
- Modify: `backend/internal/server/router.go` (wire route)

- [ ] **Step 1.1: Read existing handler patterns**

Read `backend/internal/discount/admin.go` to see how `(*Handler).List` and `(*Handler).Get` are structured (constructor, deps, response envelope via `httpx.JSON`).

- [ ] **Step 1.2: Append `Suggestions` handler to `admin.go`**

Append at the bottom of the file:

```go
// Suggestions returns lightweight aggregates used by the guided discount
// creation UI to show "💡 …" hints (panier moyen, top products, customer
// count). Read-only, no side effects, owner+admin+staff allowed.
func (h *Handler) Suggestions(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()

    var avgCents, p50Cents int64
    err := h.db.QueryRow(ctx, `
        SELECT
            COALESCE(AVG(total_cents), 0)::bigint AS avg_cents,
            COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cents), 0)::bigint AS p50_cents
        FROM orders
        WHERE financial_status = 'paid'
    `).Scan(&avgCents, &p50Cents)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
        return
    }

    var totalCustomers int64
    if err := h.db.QueryRow(ctx, `SELECT COUNT(*) FROM customers`).Scan(&totalCustomers); err != nil {
        httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
        return
    }

    rows, err := h.db.Query(ctx, `
        SELECT product_id::text
        FROM order_line_items
        WHERE product_id IS NOT NULL
        GROUP BY product_id
        ORDER BY SUM(quantity) DESC
        LIMIT 5
    `)
    if err != nil {
        httpx.Error(w, http.StatusInternalServerError, "db_error", err.Error())
        return
    }
    defer rows.Close()

    topProductIDs := []string{}
    for rows.Next() {
        var id string
        if err := rows.Scan(&id); err != nil {
            httpx.Error(w, http.StatusInternalServerError, "scan_error", err.Error())
            return
        }
        topProductIDs = append(topProductIDs, id)
    }

    httpx.JSON(w, http.StatusOK, map[string]any{
        "averageOrderValueCents": avgCents,
        "p50OrderValueCents":     p50Cents,
        "totalCustomers":         totalCustomers,
        "topProductIds":          topProductIDs,
        "currency":               "EUR",
    })
}
```

If `order_line_items` doesn't have a `product_id` column directly, replace with the actual join (likely via `variant_id → variants.product_id`). Verify in `backend/internal/db/migrations/00003_orders.sql`.

- [ ] **Step 1.3: Wire the route in `router.go`**

Modify [backend/internal/server/router.go](../../../backend/internal/server/router.go) inside the existing discount block (search for `discH := discount.NewHandler(d.DB)`). Add **before** the role-gated group:

```go
r.Get("/discounts/suggestions", discH.Suggestions)
```

- [ ] **Step 1.4: Write Go test**

Create `backend/internal/discount/admin_test.go`. Use the existing test helper pattern (look at `backend/internal/order/handler_test.go` or similar for the `pgxpool` test fixture — likely `dbtest.New(t)`):

```go
package discount

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"

    "github.com/3mg/shop/backend/internal/dbtest"
)

func TestSuggestionsEmptyShop(t *testing.T) {
    db := dbtest.New(t)
    h := NewHandler(db)

    req := httptest.NewRequest(http.MethodGet, "/api/admin/discounts/suggestions", nil)
    w := httptest.NewRecorder()
    h.Suggestions(w, req)

    if w.Code != http.StatusOK {
        t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
    }
    var got map[string]any
    if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
        t.Fatal(err)
    }
    if got["averageOrderValueCents"].(float64) != 0 {
        t.Errorf("expected 0 avg on empty shop, got %v", got["averageOrderValueCents"])
    }
    if got["totalCustomers"].(float64) != 0 {
        t.Errorf("expected 0 customers on empty shop, got %v", got["totalCustomers"])
    }
}
```

- [ ] **Step 1.5: Run tests and build**

```bash
cd backend && go test ./internal/discount/ -run TestSuggestions -v
cd backend && go build ./...
```

Expected: PASS, build clean.

- [ ] **Step 1.6: Commit**

```bash
git add backend/internal/discount/admin.go backend/internal/discount/admin_test.go backend/internal/server/router.go
git commit -m "feat(discount): add suggestions endpoint for guided creation UI"
```

---

## Task 2: Pure utility modules (types + helpers + validation + preview-math)

These four files are pure TypeScript, no React, fully unit-testable with `bun test`. We build all four in this task because they share a single `DiscountPayload` type domain.

**Files (create all):**
- `admin/app/(dash)/discounts/_forms/shared/types.ts`
- `admin/app/(dash)/discounts/_forms/shared/types.test.ts`
- `admin/app/(dash)/discounts/_forms/shared/helpers.ts`
- `admin/app/(dash)/discounts/_forms/shared/helpers.test.ts`
- `admin/app/(dash)/discounts/_forms/shared/validation.ts`
- `admin/app/(dash)/discounts/_forms/shared/validation.test.ts`
- `admin/app/(dash)/discounts/_forms/shared/preview-math.ts`
- `admin/app/(dash)/discounts/_forms/shared/preview-math.test.ts`

- [ ] **Step 2.1: Create `types.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/types.ts

// DiscountPayload mirrors the existing API contract — keep in sync with the
// type in the (deleted) DiscountForm.tsx until that file is removed.
export type DiscountKind = 'percentage' | 'amount' | 'free_shipping' | 'bogo';
export type DiscountScope = 'all' | 'products' | 'collections';
export type Eligibility = 'all' | 'segments';
export type BogoScope = 'products' | 'collections';

export type DiscountPayload = {
  code: string;
  title: string;
  kind: DiscountKind;
  valuePercent?: number | null;
  valueCents?: number | null;
  scope: DiscountScope;
  eligibility: Eligibility;
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  minSubtotalCents: number;
  bogoBuyQuantity?: number | null;
  bogoGetQuantity?: number | null;
  bogoGetDiscountPercent?: number | null;
  bogoBuyScope?: BogoScope | null;
  bogoGetScope?: BogoScope | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  productIds: string[];
  collectionIds: string[];
  buyProductIds: string[];
  buyCollectionIds: string[];
  getProductIds: string[];
  getCollectionIds: string[];
  segmentIds: string[];
};

export const EMPTY_DISCOUNT: DiscountPayload = {
  code: '',
  title: '',
  kind: 'percentage',
  valuePercent: 10,
  valueCents: null,
  scope: 'all',
  eligibility: 'all',
  usageLimit: null,
  usageLimitPerCustomer: null,
  minSubtotalCents: 0,
  bogoBuyQuantity: null,
  bogoGetQuantity: null,
  bogoGetDiscountPercent: null,
  bogoBuyScope: null,
  bogoGetScope: null,
  active: true,
  startsAt: null,
  endsAt: null,
  productIds: [],
  collectionIds: [],
  buyProductIds: [],
  buyCollectionIds: [],
  getProductIds: [],
  getCollectionIds: [],
  segmentIds: [],
};

export type TypeURL =
  | 'amount-off-order'
  | 'amount-off-products'
  | 'buy-x-get-y'
  | 'free-shipping';

export const TYPE_URLS: TypeURL[] = [
  'amount-off-order',
  'amount-off-products',
  'buy-x-get-y',
  'free-shipping',
];

export function isTypeURL(s: string): s is TypeURL {
  return (TYPE_URLS as string[]).includes(s);
}

// Map an existing discount's (kind, scope) tuple to its type-URL. Used by
// the edit page to render the right form when loading an existing record.
export function discountToTypeURL(d: Pick<DiscountPayload, 'kind' | 'scope'>): TypeURL {
  if (d.kind === 'free_shipping') return 'free-shipping';
  if (d.kind === 'bogo') return 'buy-x-get-y';
  return d.scope === 'all' ? 'amount-off-order' : 'amount-off-products';
}

// Initialize a fresh payload pre-filled for the chosen type-URL. The form
// then mutates from there.
export function initialForType(type: TypeURL): DiscountPayload {
  switch (type) {
    case 'amount-off-order':
      return { ...EMPTY_DISCOUNT, kind: 'percentage', scope: 'all', valuePercent: 10 };
    case 'amount-off-products':
      return { ...EMPTY_DISCOUNT, kind: 'percentage', scope: 'products', valuePercent: 10 };
    case 'buy-x-get-y':
      return {
        ...EMPTY_DISCOUNT,
        kind: 'bogo',
        scope: 'all',
        bogoBuyQuantity: 1,
        bogoGetQuantity: 1,
        bogoGetDiscountPercent: 100,
        bogoBuyScope: 'products',
        bogoGetScope: 'products',
        valuePercent: null,
      };
    case 'free-shipping':
      return { ...EMPTY_DISCOUNT, kind: 'free_shipping', scope: 'all', valuePercent: null };
  }
}
```

- [ ] **Step 2.2: Write `types.test.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/types.test.ts
import { describe, expect, test } from 'bun:test';
import { discountToTypeURL, initialForType, isTypeURL } from './types';

describe('discountToTypeURL', () => {
  test('free_shipping → free-shipping', () => {
    expect(discountToTypeURL({ kind: 'free_shipping', scope: 'all' })).toBe('free-shipping');
  });
  test('bogo → buy-x-get-y', () => {
    expect(discountToTypeURL({ kind: 'bogo', scope: 'all' })).toBe('buy-x-get-y');
  });
  test('percentage + scope=all → amount-off-order', () => {
    expect(discountToTypeURL({ kind: 'percentage', scope: 'all' })).toBe('amount-off-order');
  });
  test('amount + scope=products → amount-off-products', () => {
    expect(discountToTypeURL({ kind: 'amount', scope: 'products' })).toBe('amount-off-products');
  });
  test('percentage + scope=collections → amount-off-products', () => {
    expect(discountToTypeURL({ kind: 'percentage', scope: 'collections' })).toBe('amount-off-products');
  });
});

describe('initialForType', () => {
  test('amount-off-order seeds percentage+all', () => {
    const v = initialForType('amount-off-order');
    expect(v.kind).toBe('percentage');
    expect(v.scope).toBe('all');
    expect(v.valuePercent).toBe(10);
  });
  test('buy-x-get-y seeds bogo with default qty 1', () => {
    const v = initialForType('buy-x-get-y');
    expect(v.kind).toBe('bogo');
    expect(v.bogoBuyQuantity).toBe(1);
    expect(v.bogoGetDiscountPercent).toBe(100);
  });
  test('free-shipping seeds free_shipping kind', () => {
    expect(initialForType('free-shipping').kind).toBe('free_shipping');
  });
});

describe('isTypeURL', () => {
  test('rejects garbage', () => {
    expect(isTypeURL('foo')).toBe(false);
    expect(isTypeURL('')).toBe(false);
  });
  test('accepts canonical slugs', () => {
    expect(isTypeURL('amount-off-order')).toBe(true);
    expect(isTypeURL('buy-x-get-y')).toBe(true);
  });
});
```

- [ ] **Step 2.3: Run types tests, verify they pass**

```bash
cd admin && bun test app/\(dash\)/discounts/_forms/shared/types.test.ts
```

Expected: all PASS.

- [ ] **Step 2.4: Create `helpers.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/helpers.ts

const STOPWORDS = new Set([
  'the','of','a','an','for','and','to','in','on','at','by','with','&',
  'le','la','les','de','des','du','et','aux','au','un','une','en','sur','pour','dans',
]);

const RANDOM_PREFIXES = ['FLASH', 'BURST', 'SAVE', 'DEAL', 'BONUS', 'SPARK', 'SCORE'];

// deriveCode turns a free-form title into a sensible discount code.
// "Promo de printemps 2026" → "PROMOPRINTEMPS2026"
// "the spring sale!" → "SPRINGSALE"
// (only stopwords) → "PROMO" + 4 random alphanum
export function deriveCode(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  const tokens = normalized
    .split(/[^A-Z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t.toLowerCase()));
  if (tokens.length === 0) {
    return 'PROMO' + randomAlphanum(4);
  }
  return tokens.slice(0, 3).join('').slice(0, 20);
}

export function randomCode(): string {
  const prefix = RANDOM_PREFIXES[Math.floor(Math.random() * RANDOM_PREFIXES.length)];
  const suffix = String(Math.floor(Math.random() * 100)).padStart(2, '0');
  return prefix + suffix;
}

function randomAlphanum(n: number): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < n; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// formatCents → "47.20" (no currency symbol — caller adds €)
export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

// parseCents("47.2") → 4720; "" → null. Throws on NaN.
export function parseCents(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error('not a number');
  return Math.round(n * 100);
}
```

- [ ] **Step 2.5: Write `helpers.test.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/helpers.test.ts
import { describe, expect, test } from 'bun:test';
import { deriveCode, randomCode, formatCents, parseCents } from './helpers';

describe('deriveCode', () => {
  test('drops accents and stopwords', () => {
    expect(deriveCode('Promo de printemps')).toBe('PROMOPRINTEMPS');
  });
  test('drops English stopwords', () => {
    expect(deriveCode('the spring sale')).toBe('SPRINGSALE');
  });
  test('caps at 20 chars', () => {
    expect(deriveCode('a').length).toBeGreaterThan(0);
    const long = deriveCode('Supercalifragilistic Expialidocious Promotion');
    expect(long.length).toBeLessThanOrEqual(20);
  });
  test('only stopwords → PROMO + random', () => {
    const r = deriveCode('the and of');
    expect(r.startsWith('PROMO')).toBe(true);
    expect(r.length).toBe(9);
  });
  test('preserves digits', () => {
    expect(deriveCode('Sale 2026')).toBe('SALE2026');
  });
  test('strips punctuation and whitespace', () => {
    expect(deriveCode('Promo!! de printemps...')).toBe('PROMOPRINTEMPS');
  });
});

describe('randomCode', () => {
  test('format: 5+ letters then 2 digits', () => {
    const r = randomCode();
    expect(r).toMatch(/^[A-Z]{4,6}\d{2}$/);
  });
});

describe('formatCents / parseCents', () => {
  test('formatCents', () => {
    expect(formatCents(4720)).toBe('47.20');
    expect(formatCents(0)).toBe('0.00');
  });
  test('parseCents handles empty', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('  ')).toBeNull();
  });
  test('parseCents rounds correctly', () => {
    expect(parseCents('47.20')).toBe(4720);
    expect(parseCents('0.999')).toBe(100); // rounds .999 → 1.00 → 100c
  });
  test('parseCents throws on NaN', () => {
    expect(() => parseCents('abc')).toThrow();
  });
});
```

- [ ] **Step 2.6: Run helpers tests**

```bash
cd admin && bun test app/\(dash\)/discounts/_forms/shared/helpers.test.ts
```

Expected: all PASS.

- [ ] **Step 2.7: Create `validation.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/validation.ts
import type { DiscountPayload, TypeURL } from './types';

export type Issue = {
  field: string;
  variant: 'error' | 'warning';
  message: string;
};

const ALPHANUM_CODE = /^[A-Z0-9]+$/;

// Returns all issues found. Errors block save; warnings don't.
export function validate(v: DiscountPayload, type: TypeURL): Issue[] {
  const issues: Issue[] = [];

  if (!v.title.trim()) {
    issues.push({ field: 'title', variant: 'error', message: 'A title is required' });
  }

  if (v.code.length > 0) {
    if (v.code.length > 40) {
      issues.push({ field: 'code', variant: 'error', message: 'Maximum 40 characters' });
    } else if (!ALPHANUM_CODE.test(v.code)) {
      issues.push({ field: 'code', variant: 'error', message: 'Letters and digits only, no spaces' });
    }
  }

  // Value rules vary by type.
  if (type === 'amount-off-order' || type === 'amount-off-products') {
    if (v.kind === 'percentage') {
      if (v.valuePercent == null || v.valuePercent <= 0) {
        issues.push({ field: 'valuePercent', variant: 'error', message: 'Percentage must be greater than 0' });
      } else if (v.valuePercent > 100) {
        issues.push({ field: 'valuePercent', variant: 'error', message: 'Maximum 100%' });
      } else if (v.valuePercent >= 50 && v.minSubtotalCents === 0) {
        issues.push({
          field: 'valuePercent',
          variant: 'warning',
          message: 'Big discount with no minimum — set a minimum to protect yourself',
        });
      }
    } else if (v.kind === 'amount') {
      if (v.valueCents == null || v.valueCents <= 0) {
        issues.push({ field: 'valueCents', variant: 'error', message: 'Amount must be greater than 0' });
      }
    }
  }

  // Schedule rules
  if (v.startsAt && v.endsAt && new Date(v.endsAt) < new Date(v.startsAt)) {
    issues.push({ field: 'endsAt', variant: 'error', message: 'End date is before start date' });
  }
  if (v.endsAt && new Date(v.endsAt) < new Date()) {
    issues.push({
      field: 'endsAt',
      variant: 'warning',
      message: 'This date is in the past — the discount will be inactive',
    });
  }

  // Type-specific applies-to checks
  if (type === 'amount-off-products') {
    if (v.scope === 'products' && v.productIds.length === 0) {
      issues.push({
        field: 'productIds',
        variant: 'warning',
        message: 'No products selected — discount will have no effect',
      });
    }
    if (v.scope === 'collections' && v.collectionIds.length === 0) {
      issues.push({
        field: 'collectionIds',
        variant: 'warning',
        message: 'No collections selected — discount will have no effect',
      });
    }
  }

  // BOGO rules
  if (type === 'buy-x-get-y') {
    if ((v.bogoBuyQuantity ?? 0) <= 0) {
      issues.push({ field: 'bogoBuyQuantity', variant: 'error', message: 'Must be at least 1' });
    }
    if ((v.bogoGetQuantity ?? 0) <= 0) {
      issues.push({ field: 'bogoGetQuantity', variant: 'error', message: 'Must be at least 1' });
    }
    if (v.bogoGetDiscountPercent != null) {
      if (v.bogoGetDiscountPercent < 0 || v.bogoGetDiscountPercent > 100) {
        issues.push({ field: 'bogoGetDiscountPercent', variant: 'error', message: 'Must be 0–100%' });
      }
    }
  }

  return issues;
}

// hasErrors blocks save when true.
export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.variant === 'error');
}

// issuesFor returns only the issues attached to a given field.
export function issuesFor(issues: Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field);
}
```

- [ ] **Step 2.8: Write `validation.test.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/validation.test.ts
import { describe, expect, test } from 'bun:test';
import { validate, hasErrors, issuesFor } from './validation';
import { initialForType } from './types';

describe('validate', () => {
  test('empty title is an error', () => {
    const v = initialForType('amount-off-order');
    const issues = validate(v, 'amount-off-order');
    expect(issuesFor(issues, 'title')).toEqual([
      { field: 'title', variant: 'error', message: 'A title is required' },
    ]);
  });

  test('valid amount-off-order has no errors', () => {
    const v = { ...initialForType('amount-off-order'), title: 'Test' };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(false);
  });

  test('code with spaces is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', code: 'BAD CODE' };
    expect(issuesFor(validate(v, 'amount-off-order'), 'code')).toHaveLength(1);
  });

  test('percentage > 100 is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', valuePercent: 150 };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(true);
  });

  test('50% with no minimum is a warning, not an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', valuePercent: 50, minSubtotalCents: 0 };
    const issues = validate(v, 'amount-off-order');
    expect(hasErrors(issues)).toBe(false);
    expect(issuesFor(issues, 'valuePercent')).toEqual([
      expect.objectContaining({ variant: 'warning' }),
    ]);
  });

  test('end before start is an error', () => {
    const v = {
      ...initialForType('amount-off-order'),
      title: 'X',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-05-01T00:00:00Z',
    };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(true);
  });

  test('amount-off-products with empty productIds is warning', () => {
    const v = { ...initialForType('amount-off-products'), title: 'X', productIds: [] };
    const issues = validate(v, 'amount-off-products');
    expect(hasErrors(issues)).toBe(false);
    expect(issuesFor(issues, 'productIds')).toHaveLength(1);
  });

  test('BOGO buy qty 0 is an error', () => {
    const v = { ...initialForType('buy-x-get-y'), title: 'X', bogoBuyQuantity: 0 };
    expect(hasErrors(validate(v, 'buy-x-get-y'))).toBe(true);
  });
});
```

- [ ] **Step 2.9: Run validation tests**

```bash
cd admin && bun test app/\(dash\)/discounts/_forms/shared/validation.test.ts
```

Expected: all PASS.

- [ ] **Step 2.10: Create `preview-math.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/preview-math.ts
import type { DiscountPayload, TypeURL } from './types';

export type SampleLineItem = {
  productId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
};

// Hardcoded for v1 — could be plugged into real shop products later.
export const SAMPLE_CART: SampleLineItem[] = [
  { productId: 'sample-1', title: 'Klinkr T-shirt', unitPriceCents: 2500, quantity: 2 },
  { productId: 'sample-2', title: 'Klinkr Cap', unitPriceCents: 2000, quantity: 1 },
];

export const SAMPLE_SHIPPING_CENTS = 500;

export type PreviewResult = {
  subtotalCents: number;
  discountCents: number;     // positive = amount taken off
  shippingCents: number;
  totalCents: number;
  discountLabel: string | null;
  highlightedProductIds: string[];
  freeShippingApplied: boolean;
};

export function computePreview(v: DiscountPayload, type: TypeURL): PreviewResult {
  const subtotalCents = SAMPLE_CART.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const label = v.code || (v.title ? 'Automatic' : null);

  let discountCents = 0;
  let shippingCents = SAMPLE_SHIPPING_CENTS;
  let highlightedProductIds: string[] = [];
  let freeShippingApplied = false;

  switch (type) {
    case 'amount-off-order': {
      if (v.kind === 'percentage' && v.valuePercent != null) {
        discountCents = Math.round((subtotalCents * v.valuePercent) / 100);
      } else if (v.kind === 'amount' && v.valueCents != null) {
        discountCents = Math.min(v.valueCents, subtotalCents);
      }
      break;
    }
    case 'amount-off-products': {
      // Sample preview can't know real product IDs, so we simulate "the
      // first item is the discounted one" if scope=products with a selection,
      // or "all items" if no selection / scope=all.
      const eligibleSubtotal =
        v.scope === 'products' && v.productIds.length > 0
          ? SAMPLE_CART[0].unitPriceCents * SAMPLE_CART[0].quantity
          : subtotalCents;
      highlightedProductIds = v.productIds.length > 0 ? [SAMPLE_CART[0].productId] : SAMPLE_CART.map((i) => i.productId);
      if (v.kind === 'percentage' && v.valuePercent != null) {
        discountCents = Math.round((eligibleSubtotal * v.valuePercent) / 100);
      } else if (v.kind === 'amount' && v.valueCents != null) {
        discountCents = Math.min(v.valueCents, eligibleSubtotal);
      }
      break;
    }
    case 'buy-x-get-y': {
      // Simulate: buying `bogoBuyQuantity` of item 1 unlocks
      // `bogoGetQuantity` discounted units of item 2.
      const buyQty = v.bogoBuyQuantity ?? 0;
      const getQty = v.bogoGetQuantity ?? 0;
      const getPct = v.bogoGetDiscountPercent ?? 0;
      if (buyQty > 0 && getQty > 0 && SAMPLE_CART.length >= 2) {
        const cheaperPrice = SAMPLE_CART[1].unitPriceCents;
        discountCents = Math.round((cheaperPrice * getQty * getPct) / 100);
        highlightedProductIds = [SAMPLE_CART[1].productId];
      }
      break;
    }
    case 'free-shipping': {
      freeShippingApplied = true;
      shippingCents = 0;
      break;
    }
  }

  // Apply min-subtotal gate
  if (subtotalCents < v.minSubtotalCents) {
    discountCents = 0;
    if (type === 'free-shipping') {
      freeShippingApplied = false;
      shippingCents = SAMPLE_SHIPPING_CENTS;
    }
  }

  return {
    subtotalCents,
    discountCents,
    shippingCents,
    totalCents: subtotalCents - discountCents + shippingCents,
    discountLabel: label,
    highlightedProductIds,
    freeShippingApplied,
  };
}
```

- [ ] **Step 2.11: Write `preview-math.test.ts`**

```ts
// admin/app/(dash)/discounts/_forms/shared/preview-math.test.ts
import { describe, expect, test } from 'bun:test';
import { computePreview, SAMPLE_CART, SAMPLE_SHIPPING_CENTS } from './preview-math';
import { initialForType } from './types';

const subtotal = SAMPLE_CART.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);

describe('computePreview', () => {
  test('amount-off-order 10% gives correct discount', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', valuePercent: 10 };
    const r = computePreview(v, 'amount-off-order');
    expect(r.discountCents).toBe(Math.round(subtotal * 0.1));
    expect(r.totalCents).toBe(subtotal - r.discountCents + SAMPLE_SHIPPING_CENTS);
  });

  test('amount-off-order fixed €5 gives 500c discount', () => {
    const v = {
      ...initialForType('amount-off-order'),
      title: 'X', kind: 'amount' as const, valuePercent: null, valueCents: 500,
    };
    const r = computePreview(v, 'amount-off-order');
    expect(r.discountCents).toBe(500);
  });

  test('free-shipping zeros shipping', () => {
    const v = { ...initialForType('free-shipping'), title: 'X' };
    const r = computePreview(v, 'free-shipping');
    expect(r.shippingCents).toBe(0);
    expect(r.freeShippingApplied).toBe(true);
  });

  test('min subtotal gates discount', () => {
    const v = {
      ...initialForType('amount-off-order'),
      title: 'X',
      valuePercent: 10,
      minSubtotalCents: 100_000, // €1000
    };
    const r = computePreview(v, 'amount-off-order');
    expect(r.discountCents).toBe(0);
  });

  test('BOGO 1 buy + 1 get free discounts cheaper item', () => {
    const v = {
      ...initialForType('buy-x-get-y'),
      title: 'X',
      bogoBuyQuantity: 1,
      bogoGetQuantity: 1,
      bogoGetDiscountPercent: 100,
    };
    const r = computePreview(v, 'buy-x-get-y');
    expect(r.discountCents).toBe(SAMPLE_CART[1].unitPriceCents);
  });

  test('amount-off-products with selected products discounts only first item', () => {
    const v = {
      ...initialForType('amount-off-products'),
      title: 'X',
      valuePercent: 50,
      scope: 'products' as const,
      productIds: ['some-id'],
    };
    const r = computePreview(v, 'amount-off-products');
    const firstSubtotal = SAMPLE_CART[0].unitPriceCents * SAMPLE_CART[0].quantity;
    expect(r.discountCents).toBe(Math.round(firstSubtotal * 0.5));
    expect(r.highlightedProductIds).toContain(SAMPLE_CART[0].productId);
  });
});
```

- [ ] **Step 2.12: Run preview-math tests**

```bash
cd admin && bun test app/\(dash\)/discounts/_forms/shared/preview-math.test.ts
```

Expected: all PASS.

- [ ] **Step 2.13: Commit**

```bash
git add admin/app/\(dash\)/discounts/_forms/shared/types.ts admin/app/\(dash\)/discounts/_forms/shared/types.test.ts admin/app/\(dash\)/discounts/_forms/shared/helpers.ts admin/app/\(dash\)/discounts/_forms/shared/helpers.test.ts admin/app/\(dash\)/discounts/_forms/shared/validation.ts admin/app/\(dash\)/discounts/_forms/shared/validation.test.ts admin/app/\(dash\)/discounts/_forms/shared/preview-math.ts admin/app/\(dash\)/discounts/_forms/shared/preview-math.test.ts
git commit -m "feat(discounts): add pure utilities for guided discount creation"
```

---

## Task 3: Visual primitives — illustrations + FieldHint + DataSuggestion

**Files:**
- Create: `admin/app/(dash)/discounts/_forms/shared/illustrations.tsx`
- Create: `admin/app/(dash)/discounts/_forms/shared/FieldHint.tsx`
- Create: `admin/app/(dash)/discounts/_forms/shared/DataSuggestion.tsx`
- Modify: `admin/app/globals.css` (add illustration accent token)

- [ ] **Step 3.1: Add CSS token in globals.css**

In `admin/app/globals.css`, inside the `@theme { … }` block, append after `--color-accent-hover`:

```css
  --color-illustration: #d6cfb8;  /* sand — matches sidebar accent */
```

- [ ] **Step 3.2: Create `illustrations.tsx` with placeholder SVG**

For v1 we ship simple geometric placeholder SVGs that respect the accent color. Real undraw assets get swapped in during a polish pass — until then, these are functional placeholders. Each illustration component is a 120×120 SVG that uses `currentColor`:

```tsx
// admin/app/(dash)/discounts/_forms/shared/illustrations.tsx
import { type SVGProps } from 'react';

// All illustrations render at 120×120 by default and use currentColor + a
// muted secondary fill (opacity 0.3). Colour cascades via the parent's
// `color: var(--color-illustration)` style.
const baseProps = {
  width: 120,
  height: 120,
  viewBox: '0 0 120 120',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
};

export function AmountOffOrderIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="20" y="22" width="80" height="76" rx="6" fill="currentColor" opacity="0.18" />
      <path d="M28 38h64M28 52h44M28 66h54" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="86" cy="84" r="14" fill="currentColor" />
      <text x="86" y="89" fontSize="13" fontWeight="700" textAnchor="middle" fill="white">%</text>
    </svg>
  );
}

export function AmountOffProductsIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="14" y="32" width="42" height="56" rx="5" fill="currentColor" opacity="0.18" />
      <rect x="64" y="32" width="42" height="56" rx="5" fill="currentColor" opacity="0.32" />
      <circle cx="35" cy="50" r="6" fill="currentColor" />
      <circle cx="85" cy="50" r="6" fill="currentColor" />
      <path d="M22 70h26M72 70h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="20" r="14" fill="currentColor" />
      <text x="100" y="25" fontSize="11" fontWeight="700" textAnchor="middle" fill="white">-%</text>
    </svg>
  );
}

export function BuyXGetYIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="14" y="34" width="44" height="58" rx="5" fill="currentColor" opacity="0.32" />
      <rect x="62" y="34" width="44" height="58" rx="5" fill="currentColor" opacity="0.18" />
      <path d="M62 22 L84 22 L84 34 L62 34 Z" fill="currentColor" />
      <path d="M22 22 L44 22 L44 34 L22 34 Z" fill="currentColor" />
      <path d="M52 60 l8 -8 l-8 -8 M68 60 l-8 -8 l8 -8" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function FreeShippingIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="10" y="50" width="60" height="36" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="70" y="58" width="34" height="28" rx="3" fill="currentColor" opacity="0.32" />
      <path d="M70 58 l8 -10 l16 0 l10 10" stroke="currentColor" strokeWidth="3" fill="none" />
      <circle cx="30" cy="92" r="8" fill="currentColor" />
      <circle cx="86" cy="92" r="8" fill="currentColor" />
      <path d="M22 38 L8 28 M30 28 L18 18 M40 26 L34 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export type IllustrationKey = 'amount-off-order' | 'amount-off-products' | 'buy-x-get-y' | 'free-shipping';

export function illustrationFor(key: IllustrationKey) {
  switch (key) {
    case 'amount-off-order': return AmountOffOrderIllustration;
    case 'amount-off-products': return AmountOffProductsIllustration;
    case 'buy-x-get-y': return BuyXGetYIllustration;
    case 'free-shipping': return FreeShippingIllustration;
  }
}
```

- [ ] **Step 3.3: Create `FieldHint.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/FieldHint.tsx
import { type ReactNode } from 'react';

type Variant = 'error' | 'warning' | 'info';

const VARIANT_CLASS: Record<Variant, string> = {
  error: 'text-red-600',
  warning: 'text-amber-700',
  info: 'text-stone-500',
};

const ICON: Record<Variant, string> = {
  error: '⚠',
  warning: '⚠',
  info: 'ℹ',
};

export function FieldHint({
  variant,
  children,
}: {
  variant: Variant;
  children: ReactNode;
}) {
  return (
    <p className={`mt-1 text-xs ${VARIANT_CLASS[variant]}`}>
      <span className="mr-1">{ICON[variant]}</span>
      {children}
    </p>
  );
}
```

- [ ] **Step 3.4: Create `DataSuggestion.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/DataSuggestion.tsx
import { type ReactNode } from 'react';

// Renders a "💡 hint" with an optional action button. Returns null if the
// caller passes `show={false}` so we can chain without ternaries upstream.
export function DataSuggestion({
  show = true,
  children,
  action,
}: {
  show?: boolean;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  if (!show) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-600">
      <span>💡 {children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-stone-900 font-medium underline-offset-2 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3.5: Run typecheck**

```bash
cd admin && bun run typecheck
```

Expected: no errors.

- [ ] **Step 3.6: Commit**

```bash
git add admin/app/globals.css admin/app/\(dash\)/discounts/_forms/shared/illustrations.tsx admin/app/\(dash\)/discounts/_forms/shared/FieldHint.tsx admin/app/\(dash\)/discounts/_forms/shared/DataSuggestion.tsx
git commit -m "feat(discounts): add illustrations, FieldHint, DataSuggestion primitives"
```

---

## Task 4: Layout primitives — PageLayout + Header

**Files:**
- Create: `admin/app/(dash)/discounts/_forms/shared/PageLayout.tsx`
- Create: `admin/app/(dash)/discounts/_forms/shared/Header.tsx`

- [ ] **Step 4.1: Create `PageLayout.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/PageLayout.tsx
import { type ReactNode } from 'react';

export function PageLayout({
  preview,
  children,
}: {
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex-1 max-w-3xl space-y-4">{children}</div>
      <aside className="w-full lg:w-80 lg:sticky lg:top-24">{preview}</aside>
    </div>
  );
}
```

- [ ] **Step 4.2: Create `Header.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/Header.tsx
import { type ReactNode } from 'react';

export function Header({
  illustration,
  title,
  subtitle,
  badge,
}: {
  illustration: ReactNode;
  title: string;
  subtitle: string;
  badge?: ReactNode;
}) {
  return (
    <div
      className="card card-pad flex flex-col items-center gap-4 text-center md:flex-row md:items-center md:gap-6 md:text-left"
      style={{ color: 'var(--color-illustration)' }}
    >
      <div className="shrink-0">{illustration}</div>
      <div className="flex-1" style={{ color: 'var(--color-text)' }}>
        {badge && <div className="mb-1 text-xs font-medium text-stone-500">{badge}</div>}
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4.3: Typecheck**

```bash
cd admin && bun run typecheck
```

- [ ] **Step 4.4: Commit**

```bash
git add admin/app/\(dash\)/discounts/_forms/shared/PageLayout.tsx admin/app/\(dash\)/discounts/_forms/shared/Header.tsx
git commit -m "feat(discounts): add PageLayout and Header primitives"
```

---

## Task 5: MethodSection (with auto-code)

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/MethodSection.tsx`

- [ ] **Step 5.1: Create `MethodSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/MethodSection.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { deriveCode, randomCode } from './helpers';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

type Mode = 'code' | 'automatic';

export function MethodSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'code' | 'title'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  // Mode is derived: empty code = automatic, non-empty = code-mode.
  // We hold a local "mode" too so the user can switch to "code" with an
  // empty input ready for typing without losing autoderive flow.
  const [mode, setMode] = useState<Mode>(values.code ? 'code' : 'code');
  const codeTouched = useRef<boolean>(values.code.length > 0);

  // Auto-derive code from title only if user hasn't manually edited it.
  useEffect(() => {
    if (mode !== 'code') return;
    if (codeTouched.current) return;
    if (!values.title) return;
    onChange({ code: deriveCode(values.title) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.title]);

  function setModeAndClear(m: Mode) {
    setMode(m);
    if (m === 'automatic') {
      onChange({ code: '' });
      codeTouched.current = false;
    }
  }

  return (
    <Card title="Method">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-method"
            checked={mode === 'code'}
            onChange={() => setModeAndClear('code')}
          />
          Discount code
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-method"
            checked={mode === 'automatic'}
            onChange={() => setModeAndClear('automatic')}
          />
          Automatic discount
        </label>
      </div>

      <Field label="Title (admin-facing)" required className="mt-4">
        <input
          className="input"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Spring sale 2026"
        />
      </Field>
      {issuesFor(issues, 'title').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}

      {mode === 'code' ? (
        <Field label="Code (customers type this at checkout)" className="mt-3">
          <div className="flex gap-2">
            <input
              className="input font-mono uppercase flex-1"
              value={values.code}
              onChange={(e) => {
                codeTouched.current = true;
                onChange({ code: e.target.value.toUpperCase() });
              }}
              placeholder="SUMMER20"
            />
            <button
              type="button"
              onClick={() => {
                codeTouched.current = true;
                onChange({ code: randomCode() });
              }}
              className="btn"
              title="Generate a random code"
            >
              🎲
            </button>
          </div>
        </Field>
      ) : (
        <div className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
          ✨ No code required — this discount applies automatically when conditions are met.
        </div>
      )}
      {issuesFor(issues, 'code').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
```

- [ ] **Step 5.2: Typecheck**

```bash
cd admin && bun run typecheck
```

- [ ] **Step 5.3: Commit**

```bash
git add admin/app/\(dash\)/discounts/_forms/shared/MethodSection.tsx
git commit -m "feat(discounts): add MethodSection with auto-code derivation"
```

---

## Task 6: ValueSection

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/ValueSection.tsx`

- [ ] **Step 6.1: Create `ValueSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/ValueSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function ValueSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'kind' | 'valuePercent' | 'valueCents'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  const isPercent = values.kind === 'percentage';
  return (
    <Card title="Value">
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => onChange({ kind: 'percentage', valuePercent: values.valuePercent ?? 10, valueCents: null })}
          className={`btn flex-1 ${isPercent ? 'btn-primary' : ''}`}
        >
          Percentage
        </button>
        <button
          type="button"
          onClick={() => onChange({ kind: 'amount', valueCents: values.valueCents ?? 500, valuePercent: null })}
          className={`btn flex-1 ${!isPercent ? 'btn-primary' : ''}`}
        >
          Fixed amount
        </button>
      </div>

      {isPercent ? (
        <Field label="Percentage off">
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              className="input pr-8"
              value={values.valuePercent ?? ''}
              onChange={(e) =>
                onChange({ valuePercent: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
        </Field>
      ) : (
        <Field label="Amount off">
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min={0}
              className="input pl-8"
              value={values.valueCents == null ? '' : (values.valueCents / 100).toFixed(2)}
              onChange={(e) =>
                onChange({
                  valueCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                })
              }
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">€</span>
          </div>
        </Field>
      )}

      {issuesFor(issues, isPercent ? 'valuePercent' : 'valueCents').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
```

- [ ] **Step 6.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/ValueSection.tsx
git commit -m "feat(discounts): add ValueSection (percent/fixed toggle)"
```

---

## Task 7: AppliesToProductsCollectionsSection

This section is reused by `AmountOffProductsForm`, `BogoBuySection`, `BogoGetSection`. It takes configurable field-name pairs so each consumer can target the right slice of the payload (`productIds/collectionIds`, `buyProductIds/buyCollectionIds`, `getProductIds/getCollectionIds`).

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/AppliesToProductsCollectionsSection.tsx`

- [ ] **Step 7.1: Create `AppliesToProductsCollectionsSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/AppliesToProductsCollectionsSection.tsx
'use client';

import { Card, MultiPicker } from '@/components/ui';
import type { DiscountPayload } from './types';

export type Product = { id: string; title: string };
export type Collection = { id: string; title: string };

type Scope = 'products' | 'collections';

type Field = 'productIds' | 'buyProductIds' | 'getProductIds';
type CollField = 'collectionIds' | 'buyCollectionIds' | 'getCollectionIds';

export function AppliesToProductsCollectionsSection({
  title = 'Applies to',
  values,
  onChange,
  scope,
  setScope,
  productIdsField,
  collectionIdsField,
  products,
  collections,
}: {
  title?: string;
  values: DiscountPayload;
  onChange: (patch: Partial<DiscountPayload>) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  productIdsField: Field;
  collectionIdsField: CollField;
  products: Product[];
  collections: Collection[];
}) {
  const productIds = (values as any)[productIdsField] as string[];
  const collectionIds = (values as any)[collectionIdsField] as string[];

  return (
    <Card title={title}>
      <div className="space-y-2 mb-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={scope === 'products'} onChange={() => setScope('products')} />
          Specific products
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={scope === 'collections'} onChange={() => setScope('collections')} />
          Collections
        </label>
      </div>

      {scope === 'products' ? (
        <MultiPicker
          label="Products"
          options={products.map((p) => ({ id: p.id, label: p.title }))}
          selected={productIds}
          onChange={(ids) => onChange({ [productIdsField]: ids } as Partial<DiscountPayload>)}
        />
      ) : (
        <MultiPicker
          label="Collections"
          options={collections.map((c) => ({ id: c.id, label: c.title }))}
          selected={collectionIds}
          onChange={(ids) => onChange({ [collectionIdsField]: ids } as Partial<DiscountPayload>)}
        />
      )}
    </Card>
  );
}
```

- [ ] **Step 7.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/AppliesToProductsCollectionsSection.tsx
git commit -m "feat(discounts): add reusable AppliesToProductsCollectionsSection"
```

---

## Task 8: EligibilitySection

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/EligibilitySection.tsx`

- [ ] **Step 8.1: Create `EligibilitySection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/EligibilitySection.tsx
'use client';

import { Card, MultiPicker } from '@/components/ui';
import type { DiscountPayload } from './types';

export type Segment = { id: string; name: string };

export function EligibilitySection({
  values,
  onChange,
  segments,
}: {
  values: Pick<DiscountPayload, 'eligibility' | 'segmentIds'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  segments: Segment[];
}) {
  return (
    <Card title="Customer eligibility">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={values.eligibility === 'all'}
            onChange={() => onChange({ eligibility: 'all' })}
          />
          All customers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={values.eligibility === 'segments'}
            onChange={() => onChange({ eligibility: 'segments' })}
          />
          Only customers in specific segments
        </label>
      </div>
      {values.eligibility === 'segments' && (
        <div className="mt-3">
          <MultiPicker
            label="Segments"
            options={segments.map((s) => ({ id: s.id, label: s.name }))}
            selected={values.segmentIds}
            onChange={(ids) => onChange({ segmentIds: ids })}
          />
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 8.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/EligibilitySection.tsx
git commit -m "feat(discounts): add EligibilitySection"
```

---

## Task 9: LimitsSection (with data-driven suggestions)

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/LimitsSection.tsx`

- [ ] **Step 9.1: Create `LimitsSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/LimitsSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { DataSuggestion } from './DataSuggestion';

export type Suggestions = {
  averageOrderValueCents: number;
  totalCustomers: number;
} | null;

export function LimitsSection({
  values,
  onChange,
  suggestions,
}: {
  values: Pick<DiscountPayload, 'minSubtotalCents' | 'usageLimit' | 'usageLimitPerCustomer'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  suggestions: Suggestions;
}) {
  // Suggested minimum: 60% of average order value, rounded down to the
  // nearest €5. Only meaningful when avg > €0.
  const suggestedMinCents =
    suggestions && suggestions.averageOrderValueCents > 0
      ? Math.floor((suggestions.averageOrderValueCents * 0.6) / 500) * 500
      : 0;

  return (
    <Card title="Limits">
      <Field label="Minimum order subtotal (€)">
        <input
          type="number"
          step="0.01"
          min={0}
          className="input"
          value={(values.minSubtotalCents / 100).toFixed(2)}
          onChange={(e) =>
            onChange({ minSubtotalCents: Math.round(Number(e.target.value) * 100) })
          }
        />
      </Field>
      <DataSuggestion
        show={suggestedMinCents > 0 && values.minSubtotalCents !== suggestedMinCents}
        action={{
          label: `Apply €${(suggestedMinCents / 100).toFixed(0)}`,
          onClick: () => onChange({ minSubtotalCents: suggestedMinCents }),
        }}
      >
        Average order: €
        {((suggestions?.averageOrderValueCents ?? 0) / 100).toFixed(2)} — suggested minimum: €
        {(suggestedMinCents / 100).toFixed(0)}
      </DataSuggestion>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Total uses (empty = unlimited)">
          <input
            type="number"
            min={0}
            className="input"
            value={values.usageLimit ?? ''}
            onChange={(e) =>
              onChange({ usageLimit: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Uses per customer (empty = unlimited)">
          <input
            type="number"
            min={0}
            className="input"
            value={values.usageLimitPerCustomer ?? ''}
            onChange={(e) =>
              onChange({
                usageLimitPerCustomer: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </Field>
      </div>
      <DataSuggestion show={!!suggestions && suggestions.totalCustomers > 0}>
        {suggestions?.totalCustomers ?? 0} customers in your shop
      </DataSuggestion>
    </Card>
  );
}
```

- [ ] **Step 9.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/LimitsSection.tsx
git commit -m "feat(discounts): add LimitsSection with data-driven suggestions"
```

---

## Task 10: ScheduleSection

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/ScheduleSection.tsx`

- [ ] **Step 10.1: Create `ScheduleSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/ScheduleSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function toIso(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export function ScheduleSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'startsAt' | 'endsAt'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  return (
    <Card title="Active dates">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts at">
          <input
            type="datetime-local"
            className="input"
            value={toLocalInput(values.startsAt)}
            onChange={(e) => onChange({ startsAt: toIso(e.target.value) })}
          />
        </Field>
        <Field label="Ends at">
          <input
            type="datetime-local"
            className="input"
            value={toLocalInput(values.endsAt)}
            onChange={(e) => onChange({ endsAt: toIso(e.target.value) })}
          />
        </Field>
      </div>
      {issuesFor(issues, 'endsAt').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
```

- [ ] **Step 10.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/ScheduleSection.tsx
git commit -m "feat(discounts): add ScheduleSection"
```

---

## Task 11: ActiveSection (with sticky save bar)

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/ActiveSection.tsx`

- [ ] **Step 11.1: Create `ActiveSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/ActiveSection.tsx
'use client';

import { Card } from '@/components/ui';
import type { DiscountPayload } from './types';

export function ActiveSection({
  values,
  onChange,
  saving,
  saveLabel,
  onSave,
  disabled,
}: {
  values: Pick<DiscountPayload, 'active'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <Card title="Status">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => onChange({ active: e.target.checked })}
          />
          Active (live for customers)
        </label>
      </Card>

      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-3 py-3 -mx-3 rounded-b-xl">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled}
          className="btn btn-primary"
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 11.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/ActiveSection.tsx
git commit -m "feat(discounts): add ActiveSection with sticky save bar"
```

---

## Task 12: BogoBuySection + BogoGetSection

**Files:**
- Create `admin/app/(dash)/discounts/_forms/shared/BogoBuySection.tsx`
- Create `admin/app/(dash)/discounts/_forms/shared/BogoGetSection.tsx`

- [ ] **Step 12.1: Create `BogoBuySection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/BogoBuySection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { AppliesToProductsCollectionsSection, type Product, type Collection } from './AppliesToProductsCollectionsSection';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function BogoBuySection({
  values,
  onChange,
  products,
  collections,
  issues,
}: {
  values: DiscountPayload;
  onChange: (patch: Partial<DiscountPayload>) => void;
  products: Product[];
  collections: Collection[];
  issues: Issue[];
}) {
  const scope = values.bogoBuyScope ?? 'products';
  return (
    <>
      <Card title="Customer buys">
        <Field label="Quantity">
          <input
            type="number"
            min={1}
            className="input w-32"
            value={values.bogoBuyQuantity ?? 1}
            onChange={(e) => onChange({ bogoBuyQuantity: Number(e.target.value) })}
          />
        </Field>
        {issuesFor(issues, 'bogoBuyQuantity').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
      </Card>
      <AppliesToProductsCollectionsSection
        title="Buy from"
        values={values}
        onChange={onChange}
        scope={scope}
        setScope={(s) => onChange({ bogoBuyScope: s })}
        productIdsField="buyProductIds"
        collectionIdsField="buyCollectionIds"
        products={products}
        collections={collections}
      />
    </>
  );
}
```

- [ ] **Step 12.2: Create `BogoGetSection.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/BogoGetSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { AppliesToProductsCollectionsSection, type Product, type Collection } from './AppliesToProductsCollectionsSection';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function BogoGetSection({
  values,
  onChange,
  products,
  collections,
  issues,
}: {
  values: DiscountPayload;
  onChange: (patch: Partial<DiscountPayload>) => void;
  products: Product[];
  collections: Collection[];
  issues: Issue[];
}) {
  const scope = values.bogoGetScope ?? 'products';
  return (
    <>
      <Card title="Customer gets">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <input
              type="number"
              min={1}
              className="input"
              value={values.bogoGetQuantity ?? 1}
              onChange={(e) => onChange({ bogoGetQuantity: Number(e.target.value) })}
            />
          </Field>
          <Field label="Discount on those (%)">
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={values.bogoGetDiscountPercent ?? 100}
              onChange={(e) => onChange({ bogoGetDiscountPercent: Number(e.target.value) })}
            />
          </Field>
        </div>
        {issuesFor(issues, 'bogoGetQuantity').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
        {issuesFor(issues, 'bogoGetDiscountPercent').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
      </Card>
      <AppliesToProductsCollectionsSection
        title="Get from"
        values={values}
        onChange={onChange}
        scope={scope}
        setScope={(s) => onChange({ bogoGetScope: s })}
        productIdsField="getProductIds"
        collectionIdsField="getCollectionIds"
        products={products}
        collections={collections}
      />
    </>
  );
}
```

- [ ] **Step 12.3: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/BogoBuySection.tsx admin/app/\(dash\)/discounts/_forms/shared/BogoGetSection.tsx
git commit -m "feat(discounts): add BogoBuySection and BogoGetSection"
```

---

## Task 13: LivePreview

**Files:** Create `admin/app/(dash)/discounts/_forms/shared/LivePreview.tsx`

- [ ] **Step 13.1: Create `LivePreview.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/shared/LivePreview.tsx
'use client';

import { Card } from '@/components/ui';
import type { DiscountPayload, TypeURL } from './types';
import { computePreview, SAMPLE_CART, SAMPLE_SHIPPING_CENTS } from './preview-math';
import { formatCents } from './helpers';

function scheduleStatus(v: DiscountPayload): { label: string; color: string } {
  if (!v.active) return { label: '⊘ Inactive', color: 'text-stone-500' };
  const now = new Date();
  if (v.startsAt && new Date(v.startsAt) > now) {
    return { label: `⏰ Starts ${formatDate(v.startsAt)}`, color: 'text-amber-700' };
  }
  if (v.endsAt && new Date(v.endsAt) < now) {
    return { label: '⏰ Expired', color: 'text-red-600' };
  }
  return { label: '✓ Active', color: 'text-green-700' };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LivePreview({
  values,
  type,
}: {
  values: DiscountPayload;
  type: TypeURL;
}) {
  const r = computePreview(values, type);
  const status = scheduleStatus(values);
  const codeBadge = values.code
    ? values.code
    : values.title
    ? 'Automatic'
    : 'Code required';

  return (
    <Card title="Customer view">
      <div className="flex items-center justify-between text-xs">
        <span className="rounded bg-stone-900 px-2 py-1 font-mono text-white">{codeBadge}</span>
        <span className={status.color}>{status.label}</span>
      </div>

      <div className="mt-4 space-y-1 text-sm">
        {SAMPLE_CART.map((it) => {
          const highlighted = r.highlightedProductIds.includes(it.productId);
          return (
            <div
              key={it.productId}
              className={`flex justify-between ${highlighted ? 'text-stone-900 font-medium' : 'text-stone-600'}`}
            >
              <span>
                {it.title} × {it.quantity}
              </span>
              <span className="tabular">€{formatCents(it.unitPriceCents * it.quantity)}</span>
            </div>
          );
        })}
      </div>

      <hr className="my-3 border-stone-200" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-stone-600">
          <span>Subtotal</span>
          <span className="tabular">€{formatCents(r.subtotalCents)}</span>
        </div>
        {r.discountCents > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Promo {values.code || 'Automatic'}</span>
            <span className="tabular">-€{formatCents(r.discountCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-stone-600">
          <span>Shipping</span>
          <span className={`tabular ${r.freeShippingApplied ? 'text-green-700' : ''}`}>
            {r.freeShippingApplied ? <><s>€{formatCents(SAMPLE_SHIPPING_CENTS)}</s> €0.00</> : <>€{formatCents(r.shippingCents)}</>}
          </span>
        </div>
        <div className="flex justify-between font-semibold pt-1 border-t border-stone-200">
          <span>Total</span>
          <span className="tabular">€{formatCents(r.totalCents)}</span>
        </div>
      </div>

      {(values.minSubtotalCents > 0 || values.eligibility === 'segments' || values.startsAt) && (
        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {values.minSubtotalCents > 0 && <div>ℹ️ Min order €{formatCents(values.minSubtotalCents)}</div>}
          {values.eligibility === 'segments' && <div>ℹ️ Restricted to selected segments</div>}
          {values.startsAt && new Date(values.startsAt) > new Date() && <div>⏰ Starts {formatDate(values.startsAt)}</div>}
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 13.2: Typecheck and commit**

```bash
cd admin && bun run typecheck
git add admin/app/\(dash\)/discounts/_forms/shared/LivePreview.tsx
git commit -m "feat(discounts): add LivePreview with per-type cart simulation"
```

---

## Task 14: AmountOffOrderForm + dynamic route

**Files:**
- Create `admin/app/(dash)/discounts/_forms/AmountOffOrderForm.tsx`
- Create `admin/app/(dash)/discounts/new/[type]/page.tsx`

- [ ] **Step 14.1: Create the type-route resolver page**

```tsx
// admin/app/(dash)/discounts/new/[type]/page.tsx
import { notFound, redirect } from 'next/navigation';
import { isTypeURL, initialForType, type TypeURL } from '../../_forms/shared/types';
import AmountOffOrderForm from '../../_forms/AmountOffOrderForm';
import AmountOffProductsForm from '../../_forms/AmountOffProductsForm';
import BuyXGetYForm from '../../_forms/BuyXGetYForm';
import FreeShippingForm from '../../_forms/FreeShippingForm';

export default async function NewDiscountPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isTypeURL(type)) notFound();
  const initial = initialForType(type);
  switch (type) {
    case 'amount-off-order':    return <AmountOffOrderForm initial={initial} mode="create" />;
    case 'amount-off-products': return <AmountOffProductsForm initial={initial} mode="create" />;
    case 'buy-x-get-y':         return <BuyXGetYForm initial={initial} mode="create" />;
    case 'free-shipping':       return <FreeShippingForm initial={initial} mode="create" />;
  }
}
```

- [ ] **Step 14.2: Create `AmountOffOrderForm.tsx`**

```tsx
// admin/app/(dash)/discounts/_forms/AmountOffOrderForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { MethodSection } from './shared/MethodSection';
import { ValueSection } from './shared/ValueSection';
import { EligibilitySection, type Segment } from './shared/EligibilitySection';
import { LimitsSection, type Suggestions } from './shared/LimitsSection';
import { ScheduleSection } from './shared/ScheduleSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { DiscountPayload } from './shared/types';
import { hasErrors, validate } from './shared/validation';

type Mode = 'create' | 'edit';

export default function AmountOffOrderForm({
  initial,
  mode,
  id,
}: {
  initial: DiscountPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountPayload>(initial);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, sug] = await Promise.all([
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
          api<Suggestions>('/api/admin/discounts/suggestions').catch(() => null),
        ]);
        setSegments(s.items ?? []);
        setSuggestions(sug);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });
  const issues = validate(v, 'amount-off-order');
  const Illustration = illustrationFor('amount-off-order');

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      if (mode === 'create') {
        await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(v) });
      } else {
        await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(v) });
      }
      router.push('/discounts');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="amount-off-order" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Take an amount off the cart total"
        subtitle="A simple promo that applies to the entire order subtotal."
        badge={mode === 'edit' ? 'Type: Amount off order' : undefined}
      />
      <MethodSection values={v} onChange={update} issues={issues} />
      <ValueSection values={v} onChange={update} issues={issues} />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} issues={issues} />
      <ActiveSection
        values={v}
        onChange={update}
        saving={saving}
        saveLabel={mode === 'create' ? 'Create discount' : 'Save changes'}
        onSave={save}
        disabled={hasErrors(issues)}
      />
    </PageLayout>
  );
}
```

- [ ] **Step 14.3: Verify the route resolves and the form renders**

```bash
# Backend should already be running with air. Restart admin if needed:
cd admin && bun run dev
```

Manually navigate to `http://localhost:3001/discounts/new/amount-off-order` (logged in as admin) and verify the form renders with the illustration, sections, and right-rail preview.

- [ ] **Step 14.4: Commit**

```bash
git add admin/app/\(dash\)/discounts/_forms/AmountOffOrderForm.tsx admin/app/\(dash\)/discounts/new/\[type\]/page.tsx
git commit -m "feat(discounts): add AmountOffOrderForm + dynamic type route"
```

---

## Task 15: AmountOffProductsForm

**Files:** Create `admin/app/(dash)/discounts/_forms/AmountOffProductsForm.tsx`

- [ ] **Step 15.1: Create the form**

```tsx
// admin/app/(dash)/discounts/_forms/AmountOffProductsForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { MethodSection } from './shared/MethodSection';
import { ValueSection } from './shared/ValueSection';
import { AppliesToProductsCollectionsSection, type Product, type Collection } from './shared/AppliesToProductsCollectionsSection';
import { EligibilitySection, type Segment } from './shared/EligibilitySection';
import { LimitsSection, type Suggestions } from './shared/LimitsSection';
import { ScheduleSection } from './shared/ScheduleSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { DiscountPayload, DiscountScope } from './shared/types';
import { hasErrors, validate } from './shared/validation';

type Mode = 'create' | 'edit';

export default function AmountOffProductsForm({
  initial,
  mode,
  id,
}: {
  initial: DiscountPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountPayload>(initial);
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, s, sug] = await Promise.all([
          api<{ items: Product[] }>('/api/admin/products?limit=200').catch(() => ({ items: [] })),
          api<{ items: Collection[] }>('/api/admin/collections').catch(() => ({ items: [] })),
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
          api<Suggestions>('/api/admin/discounts/suggestions').catch(() => null),
        ]);
        setProducts(p.items ?? []);
        setCollections(c.items ?? []);
        setSegments(s.items ?? []);
        setSuggestions(sug);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });
  const issues = validate(v, 'amount-off-products');
  const Illustration = illustrationFor('amount-off-products');

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      if (mode === 'create') {
        await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(v) });
      } else {
        await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(v) });
      }
      router.push('/discounts');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="amount-off-products" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Run a sale on selected products"
        subtitle="Pick the products or collections that get the discount."
        badge={mode === 'edit' ? 'Type: Amount off products' : undefined}
      />
      <MethodSection values={v} onChange={update} issues={issues} />
      <ValueSection values={v} onChange={update} issues={issues} />
      <AppliesToProductsCollectionsSection
        values={v}
        onChange={update}
        scope={v.scope === 'all' ? 'products' : (v.scope as 'products' | 'collections')}
        setScope={(s) => update({ scope: s as DiscountScope })}
        productIdsField="productIds"
        collectionIdsField="collectionIds"
        products={products}
        collections={collections}
      />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} issues={issues} />
      <ActiveSection
        values={v}
        onChange={update}
        saving={saving}
        saveLabel={mode === 'create' ? 'Create discount' : 'Save changes'}
        onSave={save}
        disabled={hasErrors(issues)}
      />
    </PageLayout>
  );
}
```

- [ ] **Step 15.2: Visual check**

Navigate to `/discounts/new/amount-off-products` and verify scope toggle works, products/collections picker shows, preview updates as you type.

- [ ] **Step 15.3: Commit**

```bash
git add admin/app/\(dash\)/discounts/_forms/AmountOffProductsForm.tsx
git commit -m "feat(discounts): add AmountOffProductsForm"
```

---

## Task 16: FreeShippingForm

**Files:** Create `admin/app/(dash)/discounts/_forms/FreeShippingForm.tsx`

- [ ] **Step 16.1: Create the form** (no Value, no AppliesTo)

```tsx
// admin/app/(dash)/discounts/_forms/FreeShippingForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { MethodSection } from './shared/MethodSection';
import { EligibilitySection, type Segment } from './shared/EligibilitySection';
import { LimitsSection, type Suggestions } from './shared/LimitsSection';
import { ScheduleSection } from './shared/ScheduleSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { DiscountPayload } from './shared/types';
import { hasErrors, validate } from './shared/validation';

type Mode = 'create' | 'edit';

export default function FreeShippingForm({
  initial,
  mode,
  id,
}: {
  initial: DiscountPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountPayload>(initial);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, sug] = await Promise.all([
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
          api<Suggestions>('/api/admin/discounts/suggestions').catch(() => null),
        ]);
        setSegments(s.items ?? []);
        setSuggestions(sug);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });
  const issues = validate(v, 'free-shipping');
  const Illustration = illustrationFor('free-shipping');

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      if (mode === 'create') {
        await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(v) });
      } else {
        await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(v) });
      }
      router.push('/discounts');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="free-shipping" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Offer free shipping"
        subtitle="Remove shipping cost when conditions are met."
        badge={mode === 'edit' ? 'Type: Free shipping' : undefined}
      />
      <MethodSection values={v} onChange={update} issues={issues} />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} issues={issues} />
      <ActiveSection
        values={v}
        onChange={update}
        saving={saving}
        saveLabel={mode === 'create' ? 'Create discount' : 'Save changes'}
        onSave={save}
        disabled={hasErrors(issues)}
      />
    </PageLayout>
  );
}
```

- [ ] **Step 16.2: Visual check + commit**

Navigate to `/discounts/new/free-shipping`, verify shipping line in preview goes from €5.00 to €0.00 (struck through).

```bash
git add admin/app/\(dash\)/discounts/_forms/FreeShippingForm.tsx
git commit -m "feat(discounts): add FreeShippingForm"
```

---

## Task 17: BuyXGetYForm

**Files:** Create `admin/app/(dash)/discounts/_forms/BuyXGetYForm.tsx`

- [ ] **Step 17.1: Create the form**

```tsx
// admin/app/(dash)/discounts/_forms/BuyXGetYForm.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { MethodSection } from './shared/MethodSection';
import { BogoBuySection } from './shared/BogoBuySection';
import { BogoGetSection } from './shared/BogoGetSection';
import { EligibilitySection, type Segment } from './shared/EligibilitySection';
import { LimitsSection, type Suggestions } from './shared/LimitsSection';
import { ScheduleSection } from './shared/ScheduleSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { Product, Collection } from './shared/AppliesToProductsCollectionsSection';
import type { DiscountPayload } from './shared/types';
import { hasErrors, validate } from './shared/validation';

type Mode = 'create' | 'edit';

export default function BuyXGetYForm({
  initial,
  mode,
  id,
}: {
  initial: DiscountPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountPayload>(initial);
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, s, sug] = await Promise.all([
          api<{ items: Product[] }>('/api/admin/products?limit=200').catch(() => ({ items: [] })),
          api<{ items: Collection[] }>('/api/admin/collections').catch(() => ({ items: [] })),
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
          api<Suggestions>('/api/admin/discounts/suggestions').catch(() => null),
        ]);
        setProducts(p.items ?? []);
        setCollections(c.items ?? []);
        setSegments(s.items ?? []);
        setSuggestions(sug);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });
  const issues = validate(v, 'buy-x-get-y');
  const Illustration = illustrationFor('buy-x-get-y');

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      if (mode === 'create') {
        await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(v) });
      } else {
        await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(v) });
      }
      router.push('/discounts');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="buy-x-get-y" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Create a buy-and-get offer"
        subtitle="Reward customers who buy more — free or discounted items."
        badge={mode === 'edit' ? 'Type: Buy X get Y' : undefined}
      />
      <MethodSection values={v} onChange={update} issues={issues} />
      <BogoBuySection values={v} onChange={update} products={products} collections={collections} issues={issues} />
      <BogoGetSection values={v} onChange={update} products={products} collections={collections} issues={issues} />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} issues={issues} />
      <ActiveSection
        values={v}
        onChange={update}
        saving={saving}
        saveLabel={mode === 'create' ? 'Create discount' : 'Save changes'}
        onSave={save}
        disabled={hasErrors(issues)}
      />
    </PageLayout>
  );
}
```

- [ ] **Step 17.2: Visual check + commit**

Navigate to `/discounts/new/buy-x-get-y`, verify both Buy and Get sections render with quantity inputs and product pickers.

```bash
git add admin/app/\(dash\)/discounts/_forms/BuyXGetYForm.tsx
git commit -m "feat(discounts): add BuyXGetYForm"
```

---

## Task 18: DiscountTypeModal + list page wiring

**Files:**
- Create `admin/app/(dash)/discounts/DiscountTypeModal.tsx`
- Modify `admin/app/(dash)/discounts/page.tsx`

- [ ] **Step 18.1: Create `DiscountTypeModal.tsx`**

```tsx
// admin/app/(dash)/discounts/DiscountTypeModal.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui';
import { Tag, Gift, Inbox, Truck, ChevronRight } from 'lucide-react';
import type { TypeURL } from './_forms/shared/types';

const TYPES: Array<{
  url: TypeURL;
  title: string;
  description: string;
  Icon: typeof Tag;
}> = [
  { url: 'amount-off-products', title: 'Amount off products', description: 'Discount specific products or collections of products', Icon: Tag },
  { url: 'buy-x-get-y', title: 'Buy X get Y', description: 'Reward customers who buy more', Icon: Gift },
  { url: 'amount-off-order', title: 'Amount off order', description: 'Discount the total order amount', Icon: Inbox },
  { url: 'free-shipping', title: 'Free shipping', description: 'Offer free shipping on an order', Icon: Truck },
];

export function DiscountTypeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title="Select discount type">
      <ul className="divide-y divide-stone-200">
        {TYPES.map(({ url, title, description, Icon }) => (
          <li key={url}>
            <button
              type="button"
              onClick={() => {
                router.push(`/discounts/new/${url}`);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
            >
              <Icon size={20} className="shrink-0 text-stone-700" />
              <div className="flex-1">
                <div className="font-medium text-sm">{title}</div>
                <div className="text-xs text-stone-500">{description}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-stone-400" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
```

- [ ] **Step 18.2: Read the current list page**

Read `admin/app/(dash)/discounts/page.tsx` and locate the "Create discount" CTA (likely a link to `/discounts/new`). Capture exact pattern (server component vs client component) before modifying.

- [ ] **Step 18.3: Wire the modal into the list page**

Convert the Create CTA from a link to a button that opens `DiscountTypeModal`. If the list page is a server component, wrap the button + modal in a small `'use client'` child component (e.g. `CreateButton.tsx`). Keep the rest of the list page server-side.

Replace the existing CTA `<Link href="/discounts/new">Create discount</Link>` with:

```tsx
// In page.tsx (or a small CreateButton.tsx if page.tsx is RSC)
'use client';
import { useState } from 'react';
import { DiscountTypeModal } from './DiscountTypeModal';

export function CreateDiscountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Create discount
      </button>
      <DiscountTypeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

Then import and use `<CreateDiscountButton />` in `page.tsx` where the old link was.

- [ ] **Step 18.4: Visual check**

Navigate to `/discounts`, click "Create discount", verify the modal opens with 4 options and clicking one navigates to the right `/discounts/new/[type]` URL.

- [ ] **Step 18.5: Commit**

```bash
git add admin/app/\(dash\)/discounts/DiscountTypeModal.tsx admin/app/\(dash\)/discounts/page.tsx
# add CreateButton.tsx too if extracted
git commit -m "feat(discounts): add DiscountTypeModal and wire list-page CTA"
```

---

## Task 19: `/discounts/new` redirect helper

**Files:** Create `admin/app/(dash)/discounts/new/page.tsx`

If a user lands directly on `/discounts/new` (bookmark, old link), redirect them to the list with a query param that auto-opens the modal.

- [ ] **Step 19.1: Create the page**

```tsx
// admin/app/(dash)/discounts/new/page.tsx
import { redirect } from 'next/navigation';

export default function NewDiscountIndex() {
  redirect('/discounts?new=1');
}
```

- [ ] **Step 19.2: Make the list page open the modal when `?new=1`**

In the list page (or `CreateDiscountButton.tsx` from Task 18), read `useSearchParams()` and seed the modal `open` state from `?new=1`. Update inside `CreateDiscountButton`:

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DiscountTypeModal } from './DiscountTypeModal';

export function CreateDiscountButton() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      router.replace('/discounts');
    }
  }, [params, router]);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        Create discount
      </button>
      <DiscountTypeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 19.3: Visual check + commit**

Navigate to `/discounts/new` directly, verify it redirects to `/discounts` and the modal opens.

```bash
git add admin/app/\(dash\)/discounts/new/page.tsx admin/app/\(dash\)/discounts/page.tsx
git commit -m "feat(discounts): redirect /discounts/new to list with modal autoopen"
```

---

## Task 20: Rewrite `/discounts/[id]/page.tsx`

**Files:** Modify `admin/app/(dash)/discounts/[id]/page.tsx`

- [ ] **Step 20.1: Read existing file**

Read `admin/app/(dash)/discounts/[id]/page.tsx` to understand the current edit page (server vs client, how it fetches the discount).

- [ ] **Step 20.2: Rewrite to dispatch on type-URL**

Replace the entire body with:

```tsx
// admin/app/(dash)/discounts/[id]/page.tsx
'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import { discountToTypeURL, type DiscountPayload } from '../_forms/shared/types';
import AmountOffOrderForm from '../_forms/AmountOffOrderForm';
import AmountOffProductsForm from '../_forms/AmountOffProductsForm';
import BuyXGetYForm from '../_forms/BuyXGetYForm';
import FreeShippingForm from '../_forms/FreeShippingForm';

export default function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [discount, setDiscount] = useState<DiscountPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<DiscountPayload>(`/api/admin/discounts/${id}`);
        setDiscount(d);
      } catch {
        setMissing(true);
      }
    })();
  }, [id]);

  if (missing) notFound();
  if (!discount) return <div className="p-6 text-stone-500">Loading…</div>;

  const type = discountToTypeURL(discount);
  switch (type) {
    case 'amount-off-order':    return <AmountOffOrderForm initial={discount} mode="edit" id={id} />;
    case 'amount-off-products': return <AmountOffProductsForm initial={discount} mode="edit" id={id} />;
    case 'buy-x-get-y':         return <BuyXGetYForm initial={discount} mode="edit" id={id} />;
    case 'free-shipping':       return <FreeShippingForm initial={discount} mode="edit" id={id} />;
  }
}
```

If the existing `GET /api/admin/discounts/{id}` response doesn't match `DiscountPayload` shape exactly (e.g. nested `discount: {...}` envelope), adapt the destructuring. Inspect the server response shape first.

- [ ] **Step 20.3: Visual check**

Create a discount via the new flow, then navigate to `/discounts/[id]`. Verify the edit form loads pre-populated, the type-badge appears, the type modal does NOT show, and saving updates correctly.

- [ ] **Step 20.4: Commit**

```bash
git add admin/app/\(dash\)/discounts/\[id\]/page.tsx
git commit -m "feat(discounts): rewrite edit page to dispatch on discount type"
```

---

## Task 21: Rewrite e2e tests

**Files:** Modify `e2e/tests/phase6-discounts.spec.ts`

- [ ] **Step 21.1: Read existing test**

Read `e2e/tests/phase6-discounts.spec.ts` to understand the helpers used (login, page object patterns, admin auth setup).

- [ ] **Step 21.2: Rewrite with the new flow**

Replace the whole file. The shape:

```ts
// e2e/tests/phase6-discounts.spec.ts
import { test, expect } from '@playwright/test';
// Reuse whatever login helper the existing suite uses (e.g. ../helpers/login.ts)
import { loginAsAdmin } from '../helpers/login';

test.describe('Guided discount creation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('creates an amount-off-order discount via the modal', async ({ page }) => {
    await page.goto('/discounts');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await page.getByRole('button', { name: /Amount off order/i }).click();
    await expect(page).toHaveURL(/\/discounts\/new\/amount-off-order/);

    await page.getByLabel('Title (admin-facing)').fill('E2E test 10%');
    // Auto-derived code; assert it's populated
    await expect(page.getByLabel(/Code/)).toHaveValue(/E2ETEST10/);

    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL('/discounts');
    await expect(page.getByText('E2E test 10%')).toBeVisible();
  });

  test('creates a free-shipping discount', async ({ page }) => {
    await page.goto('/discounts');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await page.getByRole('button', { name: /Free shipping/i }).click();
    await page.getByLabel('Title (admin-facing)').fill('Free ship E2E');
    // LivePreview must show free shipping
    await expect(page.locator('text=€0.00')).toBeVisible();
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL('/discounts');
  });

  test('creates a buy-x-get-y discount', async ({ page }) => {
    await page.goto('/discounts');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await page.getByRole('button', { name: /Buy X get Y/i }).click();
    await page.getByLabel('Title (admin-facing)').fill('BOGO E2E');
    await page.getByLabel('Quantity').first().fill('1');
    // get qty + discount % defaults to 1 + 100, leave them
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL('/discounts');
  });

  test('creates an amount-off-products discount and edits it', async ({ page }) => {
    await page.goto('/discounts');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await page.getByRole('button', { name: /Amount off products/i }).click();
    await page.getByLabel('Title (admin-facing)').fill('Products E2E');
    await page.getByRole('button', { name: 'Create discount' }).click();
    await expect(page).toHaveURL('/discounts');

    // Edit
    await page.getByText('Products E2E').click();
    await expect(page.getByText(/Type: Amount off products/)).toBeVisible();
    await page.getByLabel('Title (admin-facing)').fill('Products E2E (edited)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL('/discounts');
    await expect(page.getByText('Products E2E (edited)')).toBeVisible();
  });
});
```

- [ ] **Step 21.3: Run e2e**

```bash
cd e2e && bun run test
```

Expected: all 4 tests PASS. Fix any selector mismatches by inspecting the rendered DOM.

- [ ] **Step 21.4: Commit**

```bash
git add e2e/tests/phase6-discounts.spec.ts
git commit -m "test(discounts): rewrite e2e for guided creation + edit"
```

---

## Task 22: Delete old `DiscountForm.tsx`, final cleanup

**Files:** Delete `admin/app/(dash)/discounts/DiscountForm.tsx`

- [ ] **Step 22.1: Verify no references**

```bash
grep -rn "DiscountForm" admin/ --include="*.tsx" --include="*.ts" | grep -v _forms/ | grep -v node_modules
```

Expected: empty (or only the file itself).

- [ ] **Step 22.2: Delete the file**

```bash
git rm admin/app/\(dash\)/discounts/DiscountForm.tsx
```

- [ ] **Step 22.3: Run typecheck + full test suite + build**

```bash
cd admin && bun run typecheck && bun run build
cd .. && task test:go
cd e2e && bun run test
```

Expected: all green.

- [ ] **Step 22.4: Final commit**

```bash
git commit -m "refactor(discounts): remove old monolithic DiscountForm.tsx"
```

---

## Self-review

**Spec coverage check:** Each section of the spec maps to ≥1 task:
- §4 Routing & file layout → Task 14 (route resolver), Task 18 (modal), Task 19 (redirect), Task 20 (edit)
- §5 Component architecture → Tasks 4–13 (primitives + sections + LivePreview), Tasks 14–17 (forms)
- §6 LivePreview → Task 13
- §7 Smart helpers → Task 1 (Suggestions endpoint), Task 2 (deriveCode + validation), Task 5 (auto-code wiring), Task 9 (suggestions UI consumption)
- §8 Visual identity → Task 3 (illustrations + token), Task 4 (Header + PageLayout), copy embedded throughout forms
- §9 Edit flow → Task 20
- §10 Backend → Task 1
- §11 Testing → Tasks 1, 2 (unit), Task 21 (e2e); UI component unit tests deliberately skipped (no infra in repo)
- §12 Cutover & order → Tasks 18, 22

**Placeholder scan:** No "TBD" / "TODO" / "implement later". One area where the engineer needs to verify against actual schema (Task 1 step 1.2: `order_line_items.product_id` may need a join through variants — explicitly flagged). Task 18 step 18.2 + Task 20 step 20.1 ask the engineer to read the existing file first because the exact pattern (RSC vs CC, response envelope shape) wasn't pinned in the spec — pragmatic, the alternative is brittle assumptions.

**Type consistency:** `DiscountPayload`, `TypeURL`, `Issue`, `Suggestions`, `Product`, `Collection`, `Segment` are all defined once and reused with the same names everywhere they appear.

**Risk note:** Tasks 14, 15, 16, 17 have a lot of structural similarity. An executor may be tempted to extract a generic `<DiscountFormShell>` — resist. The 4 forms diverge in subtle ways (which sections appear, which scope subset is allowed, type badge label) and a generic shell complicates the type narrowing. Keep the four files explicit per the design's Approach 2.

---

## Execution
