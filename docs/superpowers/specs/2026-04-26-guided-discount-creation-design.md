# Guided Discount Creation — Design Spec

**Date:** 2026-04-26
**Branch:** `coffrage` (or new `discount-redesign`)
**Status:** Approved design, plan pending

## 1. Goal

Replace the current monolithic discount form ([admin/app/(dash)/discounts/DiscountForm.tsx](../../../admin/app/(dash)/discounts/DiscountForm.tsx)) with a Shopify-style guided experience: a type-picker modal followed by a tailored, single-page form per discount type. Layer in small SVG illustrations, warmer copy, a live customer-preview panel, auto-generated codes, friendly inline validation, and data-driven suggestions to make creation feel simple.

## 2. Non-goals

- Changing the data model — current `discounts` schema (`kind` × `scope`) supports all four Shopify-equivalent types.
- Multi-step wizard inside a single type (we go single-page per type, like Shopify).
- Allowing the discount type to be changed after creation (Shopify forbids this; we follow).
- Touching the discount **list** page beyond replacing its "Create discount" CTA.
- Translating the rest of the admin to French — the new form copy is **English** to match the rest of the admin.

## 3. Approach

**Approach 2** from brainstorming: one form per type, composed of shared section primitives. Four small, readable top-level forms (~50–80 lines each). Type-specific logic (BOGO buy/get, products vs collections picker, percent vs fixed amount) lives in dedicated sections; everything else (method, eligibility, limits, schedule, activation) is shared.

## 4. Routing & file layout

### URLs

- `/discounts` — list (existing). The **Create discount** button opens `DiscountTypeModal` instead of navigating away.
- `/discounts/new/[type]` — new dynamic segment. Renders the form for `type` ∈ `amount-off-order` | `amount-off-products` | `buy-x-get-y` | `free-shipping`.
- `/discounts/[id]` — edit. Loads the discount, computes its type-URL, and renders the same form as creation **without** the type modal. Type is fixed.

If a user navigates to `/discounts/new` directly (no type), it redirects to `/discounts?new=1` so the modal opens on the list page.

### File layout

```
admin/app/(dash)/discounts/
├── page.tsx                          # list (modified: opens modal on Create)
├── DiscountTypeModal.tsx             # NEW
├── new/
│   ├── page.tsx                      # NEW (redirect helper)
│   └── [type]/page.tsx               # NEW (resolves type slug → form)
├── [id]/page.tsx                     # MODIFIED (uses new forms)
└── _forms/                           # NEW (underscore = Next.js private)
    ├── shared/
    │   ├── PageLayout.tsx
    │   ├── Header.tsx
    │   ├── MethodSection.tsx
    │   ├── ValueSection.tsx
    │   ├── AppliesToProductsCollectionsSection.tsx
    │   ├── EligibilitySection.tsx
    │   ├── LimitsSection.tsx
    │   ├── ScheduleSection.tsx
    │   ├── ActiveSection.tsx
    │   ├── LivePreview.tsx
    │   ├── DataSuggestion.tsx
    │   ├── FieldHint.tsx
    │   ├── illustrations.tsx          # inline SVG components, recolorable via CSS var
    │   ├── helpers.ts                 # deriveCode, slug helpers, formatters
    │   ├── preview-math.ts            # pure functions for sample-cart math
    │   ├── validation.ts              # validate() returning typed warnings/errors
    │   └── types.ts                   # TypeURL ↔ (kind, scope) mapping
    ├── AmountOffOrderForm.tsx
    ├── AmountOffProductsForm.tsx
    ├── BuyXGetYForm.tsx
    └── FreeShippingForm.tsx
```

### Type-URL ↔ payload mapping

| URL slug | `kind` | `scope` |
|---|---|---|
| `amount-off-order` | `percentage` or `amount` (toggle in ValueSection) | `all` |
| `amount-off-products` | `percentage` or `amount` | `products` or `collections` |
| `buy-x-get-y` | `bogo` | `all` (unused by engine for BOGO) |
| `free-shipping` | `free_shipping` | `all` |

```ts
// _forms/shared/types.ts
export type TypeURL = 'amount-off-order' | 'amount-off-products' | 'buy-x-get-y' | 'free-shipping';

export function discountToTypeURL(d: Pick<DiscountPayload, 'kind' | 'scope'>): TypeURL {
  if (d.kind === 'free_shipping') return 'free-shipping';
  if (d.kind === 'bogo') return 'buy-x-get-y';
  return d.scope === 'all' ? 'amount-off-order' : 'amount-off-products';
}
```

## 5. Component architecture

### Shared sections (props pattern)

Every shared section takes `values` (a slice of `DiscountPayload`) + `onChange(patch: Partial<DiscountPayload>)`. Self-contained, isolated, testable.

| Section | Purpose | Owns |
|---|---|---|
| `<PageLayout>` | 2-column shell: form (left, max-w-3xl) + LivePreview (right, w-80, sticky, top-24). Stacked on `<lg`. | layout |
| `<Header>` | 120×120 SVG illustration + H1 + subtitle | presentation |
| `<MethodSection>` | Code or automatic toggle, title, auto-code from title | `code`, `title` |
| `<ValueSection>` | Percent vs fixed amount toggle + value input | `kind`, `valuePercent`, `valueCents` |
| `<AppliesToProductsCollectionsSection>` | Toggle "specific products" / "collections" + MultiPicker | `scope`, `productIds`, `collectionIds` (configurable field-name pair so BOGO can reuse with `buyProductIds`/`getProductIds`) |
| `<EligibilitySection>` | All vs segments + segment picker | `eligibility`, `segmentIds` |
| `<LimitsSection>` | Min subtotal, total uses, per-customer uses, with `<DataSuggestion>` hints | `minSubtotalCents`, `usageLimit`, `usageLimitPerCustomer` |
| `<ScheduleSection>` | Start / end datetime | `startsAt`, `endsAt` |
| `<ActiveSection>` | Active toggle + sticky save bar | `active` (also handles `onSave`) |
| `<LivePreview>` | Renders the customer-side simulation | reads full `values` + `type` |
| `<DataSuggestion>` | Renders a "💡 …" hint with optional "Apply" action; renders nothing if data is missing or zero | self |
| `<FieldHint>` | Inline hint under a field, variants `error` / `warning` / `info` | self |

### Per-type composition

```tsx
// AmountOffProductsForm.tsx (illustrative — full code at implementation)
function AmountOffProductsForm({ initial, onSave }: Props) {
  const [v, setV] = useState(initial);
  const update = (p: Partial<DiscountPayload>) => setV({ ...v, ...p });
  // ...load products, collections, segments, suggestions...

  return (
    <PageLayout preview={<LivePreview values={v} type="amount-off-products" />}>
      <Header
        illustration={<AmountOffProductsIllustration />}
        title="Run a sale on selected products"
        subtitle="Pick the products or collections that get the discount."
      />
      <MethodSection values={v} onChange={update} />
      <ValueSection values={v} onChange={update} />
      <AppliesToProductsCollectionsSection
        values={v} onChange={update}
        products={products} collections={collections}
        productIdsField="productIds" collectionIdsField="collectionIds"
      />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} />
      <ActiveSection values={v} onChange={update} onSave={() => onSave(v)} />
    </PageLayout>
  );
}
```

| Form | Type-specific sections it includes |
|---|---|
| `AmountOffOrderForm` | `<ValueSection>` |
| `AmountOffProductsForm` | `<ValueSection>` + `<AppliesToProductsCollectionsSection>` |
| `BuyXGetYForm` | `<BogoBuySection>` (qty + scope + picker) + `<BogoGetSection>` (qty + scope + picker + discount %) — both wrap `<AppliesToProductsCollectionsSection>` |
| `FreeShippingForm` | (none — no value, no applies-to) |

### State

Single `useState<DiscountPayload>` per form. Pattern `update(patch)` (current convention preserved). No Context, no store — out of scope.

## 6. Live Preview

### Layout

Sticky right column, 320px wide on desktop, drawer on mobile (collapsed by default, toggled via FAB).

```
┌─────────────────────────────────┐
│ Customer view                   │
├─────────────────────────────────┤
│ [PROMO20]  ✓ Active             │
│                                 │
│ Sample cart:                    │
│ Klinkr T-shirt  × 2   €50.00    │
│ Klinkr Cap      × 1   €20.00    │
│                                 │
│ Subtotal              €70.00    │
│ Promo PROMO20         -€7.00    │  ← highlighted
│ Shipping              €5.00     │  ← (or €0.00 for free shipping)
│ ───                             │
│ Total                 €68.00    │
│                                 │
│ ℹ️ Min order €30                 │
│ ℹ️ Restricted to "VIP" segment   │
│ ⏰ Starts May 5 at 09:00         │
└─────────────────────────────────┘
```

### Per-type rules

| Type | Preview behavior |
|---|---|
| Amount off order | Discount applied to whole subtotal |
| Amount off products | Discount applied only to matching line items (visual highlight) |
| Buy X get Y | Two lines: "Bought item" + "Free / discounted item" in green |
| Free shipping | Shipping line goes from €5.00 → **€0.00** in green; no discount line on products |

### Edge cases

- Incomplete fields → placeholder ("Set a value" muted) instead of "—€"
- No code & not automatic → badge "Code required"
- Schedule expired → red "⏰ Expired" instead of "Active"
- Schedule pending → orange "⏰ Starts on X"
- `active = false` → everything muted, badge "⊘ Inactive"

### Implementation

- `<LivePreview values={v} type={...} />` — pure component, no API calls.
- Math lives in `_forms/shared/preview-math.ts` — pure functions, fully unit-tested.
- `SAMPLE_CART` constant at the top of preview-math.ts (3 items, mixed quantities). Future iteration could plug real shop products.
- Re-renders on every keystroke; math is sub-millisecond, no debounce needed.

## 7. Smart helpers

### Auto code generation

```ts
// _forms/shared/helpers.ts
export function deriveCode(title: string): string {
  // 1. NFD normalize, strip combining marks, uppercase
  // 2. Split on non-alphanum, drop common stopwords (the, of, a, an, for, and, &, …)
  // 3. Take 2–3 first significant tokens, concat (no separator), max 20 chars
  // 4. If empty (only stopwords / digits), return "PROMO" + 4 random alphanum
}
```

- Triggered in `<MethodSection>` on every keystroke in the title input, **only** if user hasn't manually edited the code field (local `codeTouched` flag).
- Button `🎲 Generate another` next to the code input → returns one of a small set ("FLASH", "BURST", "SAVE", "DEAL", "BONUS", …) + 2-digit random suffix.
- Automatic mode: code field hidden, replaced by badge "No code required".

### Inline validation

`<FieldHint variant="error" | "warning" | "info">` — icon + message under the field. Errors block save; warnings don't.

| Field | Rule | Variant | Message |
|---|---|---|---|
| `code` | non-alphanum or whitespace | error | "Letters and digits only, no spaces" |
| `code` | > 40 chars | error | "Maximum 40 characters" |
| `valuePercent` | > 100 | error | "Maximum 100%" |
| `valuePercent` | ≥ 50 and `minSubtotalCents` = 0 | warning | "Big discount with no minimum — set a minimum on the right to protect yourself" |
| `valueCents` | ≤ 0 | error | "Amount must be greater than 0" |
| `endsAt` | < `startsAt` | error | "End date is before start date" |
| `endsAt` | < now | warning | "This date is in the past — the discount will be inactive" |
| `productIds` | empty & scope=products | warning | "No products selected — discount will have no effect" |
| `title` | empty (on save) | error | "A title is required" |
| BOGO `bogoBuyQuantity` | ≤ 0 | error | "Must be at least 1" |
| BOGO `bogoGetQuantity` | ≤ 0 | error | "Must be at least 1" |

Client-side only. Server-side validation remains source of truth; on server error, the message is shown at the top of the form.

### Data-driven suggestions

**New backend endpoint:** `GET /api/admin/discounts/suggestions`

```json
{
  "averageOrderValueCents": 4720,
  "p50OrderValueCents": 3500,
  "totalCustomers": 542,
  "topProductIds": ["uuid1", "uuid2", "uuid3"],
  "currency": "EUR"
}
```

Implemented in `backend/internal/discount/admin.go` as `(*Handler).Suggestions`. Three SQL queries:

- `SELECT COALESCE(AVG(total_cents), 0)::bigint, COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_cents), 0)::bigint FROM orders WHERE financial_status = 'paid'`
- `SELECT COUNT(*) FROM customers`
- `SELECT product_id FROM order_items GROUP BY product_id ORDER BY SUM(quantity) DESC LIMIT 5`

Wired in [backend/internal/server/router.go](../../../backend/internal/server/router.go) discount block:
```go
r.Get("/discounts/suggestions", discH.Suggestions)
```

Owner+Admin+Staff (read endpoint, no extra role gate).

**UI consumption:**

| Section | Suggestion |
|---|---|
| `<LimitsSection>` (min subtotal) | "💡 Average order: €47.20 — suggested minimum: €30" + button "Apply €30" |
| `<LimitsSection>` (usage limit) | "💡 542 customers in your shop" (info only) |
| `<EligibilitySection>` | "💡 Segment 'VIP': 12 customers" (sourced from existing segment list) |

`<DataSuggestion>` renders nothing if the underlying data is zero or absent (fresh shop). No "💡 Average order: €0.00" noise.

## 8. Visual identity

### Illustrations

- Source: [undraw.co](https://undraw.co) — MIT licensed, single-color recolorable.
- Inlined as JSX SVG in `_forms/shared/illustrations.tsx`. Recolor via CSS custom property: `fill: var(--accent-illustration)`, set in `app/globals.css`.
- 4 illustrations total (one per type). The modal uses Lucide icons (no big illustrations) — matches Shopify's restraint.
- Specific undraw assets to be picked during implementation (2–3 candidates per type proposed for user validation).

| Slot | Themed by |
|---|---|
| Modal "Select discount type" | 4 Lucide icons (`Tag`, `Gift`, `Inbox`, `Truck`) |
| Page `amount-off-order` | Receipt / cart with discount tag |
| Page `amount-off-products` | Products with price labels |
| Page `buy-x-get-y` | Gift / bonus / doubled cart |
| Page `free-shipping` | Delivery truck / floating package |

### Header layout (desktop)

```
┌──────────────────────────────────────┐
│  ┌────────┐                          │
│  │ 120px  │  Run a sale on …          │ ← H1, font-semibold, text-2xl
│  │  SVG   │  selected products        │
│  │        │                           │
│  │        │  Pick the products or …   │ ← subtitle, text-sm, muted
│  └────────┘                           │
└──────────────────────────────────────┘
```

Mobile: illustration above title, centered.

### Copy tone

English, warm but professional. Single-shop admin, but consistent with the rest of the admin (English).

| Slot | Copy |
|---|---|
| Modal title | "Select discount type" |
| Modal items | "Amount off products — Discount specific products or collections" / "Buy X get Y — Run a 'buy and get' offer" / "Amount off order — Discount the total cart" / "Free shipping — Offer free delivery" |
| Page H1 (amount-off-order) | "Take an amount off the cart total" |
| Page H1 (amount-off-products) | "Run a sale on selected products" |
| Page H1 (buy-x-get-y) | "Create a buy-and-get offer" |
| Page H1 (free-shipping) | "Offer free shipping" |
| Section "Method" | "Method" |
| Method options | "Discount code" / "Automatic discount" |
| Section "Value" | "Value" |
| Section "Applies to" | "Applies to" |
| Section "Eligibility" | "Customer eligibility" |
| Section "Limits" | "Limits" |
| Section "Schedule" | "Active dates" |
| Section "Activation" | "Status" |
| Save button | "Save" / "Save changes" |
| Sticky save bar (dirty) | "You have unsaved changes" + "Save" button |

## 9. Edit flow

`/discounts/[id]/page.tsx`:

1. Fetch discount via existing `GET /api/admin/discounts/{id}`.
2. Compute `typeURL = discountToTypeURL(discount)`.
3. Render the matching form (`<AmountOffProductsForm initial={discount} onSave={save} />`, etc.).
4. No type modal. The `<Header>` shows the type's illustration plus a small badge "Type: …" in the subtitle area.
5. Type is **immutable** for an existing discount. Changing type would require delete + recreate (out of scope v1).

## 10. Backend changes

Single new endpoint described in §7. No schema changes, no migration. The current `discounts` schema (`kind` × `scope` plus `bogo_*` fields) supports all four type-URLs.

Routing wire-up:

```go
// backend/internal/server/router.go (inside the existing discount block)
r.Get("/discounts/suggestions", discH.Suggestions)
```

## 11. Testing

| Level | Target |
|---|---|
| Unit | `deriveCode()`, `discountToTypeURL()`, `preview-math.ts` per type, `validation.ts` rules |
| Component | Each shared section in isolation (props in, DOM out) |
| Component | Each top-level form — submit produces correct payload per type |
| E2E | Playwright: rewrite [e2e/tests/phase6-discounts.spec.ts](../../../e2e/tests/phase6-discounts.spec.ts) — for each type, click "Create discount" → modal → pick type → fill → save → reopen → edit → save again → verify in list |
| Backend | `Suggestions()`: zero-orders shop returns sensible zeros, populated shop returns expected aggregates |

## 12. Cutover & implementation order

No feature flag (admin is a single user, single shop). Strategy:

1. Build new code alongside the old one (`_forms/`, `DiscountTypeModal.tsx`, new routes).
2. Wire the list-page CTA to open the modal.
3. Rewrite `/discounts/[id]/page.tsx` to use new forms.
4. Rewrite e2e tests.
5. Delete `admin/app/(dash)/discounts/DiscountForm.tsx`.
6. Single PR on a feature branch (e.g. `discount-redesign`) merged into `coffrage` then `main`.

### Suggested implementation order (input for the plan)

1. Backend `Suggestions` endpoint + Go tests.
2. Shared primitives: `helpers.ts`, `types.ts`, `validation.ts`, `preview-math.ts`, `illustrations.tsx`, `PageLayout.tsx`, `Header.tsx`, `FieldHint.tsx`, `DataSuggestion.tsx`.
3. Shared sections (Method, Value, AppliesToProductsCollections, Eligibility, Limits, Schedule, Active).
4. `LivePreview.tsx`.
5. `AmountOffOrderForm` (simplest, validates the primitives end-to-end).
6. `AmountOffProductsForm`.
7. `FreeShippingForm`.
8. `BuyXGetYForm` (most complex, benefits from everything before).
9. `DiscountTypeModal` + list-page wiring.
10. `/discounts/[id]/page.tsx` rewrite.
11. E2E rewrite.
12. Delete `DiscountForm.tsx`.

Rough estimate: 1.5–2 days of focused work for a developer familiar with the codebase.

## 13. Out of scope (explicit)

- Translating the rest of the admin to French.
- Allowing changing a discount's type after creation.
- Plugging `<LivePreview>` into real shop products (uses a hardcoded SAMPLE_CART).
- A/B testing or experimenting with two flows.
- Caching the `Suggestions` endpoint response.
- A dedicated success screen after creation (we just return to `/discounts`).
- Bulk discount creation, import/export of discounts, discount duplication (Shopify has these, we don't yet).
