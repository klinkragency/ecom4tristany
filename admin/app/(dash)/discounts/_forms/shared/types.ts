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

// The server response uses *omitempty* on nullable / empty-array fields and
// includes read-only metadata (id, usageCount, createdAt, …). Normalize
// against EMPTY_DISCOUNT so we can hand a clean writable payload to forms or
// to PUT /api/admin/discounts/{id} (which rejects unknown fields).
export type DiscountResponse = Partial<DiscountPayload> & { code?: string | null };

export function normalizeDiscount(d: DiscountResponse): DiscountPayload {
  return {
    ...EMPTY_DISCOUNT,
    code: d.code ?? '',
    title: d.title ?? '',
    kind: (d.kind as DiscountPayload['kind']) ?? EMPTY_DISCOUNT.kind,
    valuePercent: d.valuePercent ?? null,
    valueCents: d.valueCents ?? null,
    scope: (d.scope as DiscountPayload['scope']) ?? EMPTY_DISCOUNT.scope,
    eligibility: (d.eligibility as DiscountPayload['eligibility']) ?? EMPTY_DISCOUNT.eligibility,
    usageLimit: d.usageLimit ?? null,
    usageLimitPerCustomer: d.usageLimitPerCustomer ?? null,
    minSubtotalCents: d.minSubtotalCents ?? 0,
    bogoBuyQuantity: d.bogoBuyQuantity ?? null,
    bogoGetQuantity: d.bogoGetQuantity ?? null,
    bogoGetDiscountPercent: d.bogoGetDiscountPercent ?? null,
    bogoBuyScope: d.bogoBuyScope ?? null,
    bogoGetScope: d.bogoGetScope ?? null,
    active: d.active ?? true,
    startsAt: d.startsAt ?? null,
    endsAt: d.endsAt ?? null,
    productIds: d.productIds ?? [],
    collectionIds: d.collectionIds ?? [],
    buyProductIds: d.buyProductIds ?? [],
    buyCollectionIds: d.buyCollectionIds ?? [],
    getProductIds: d.getProductIds ?? [],
    getCollectionIds: d.getCollectionIds ?? [],
    segmentIds: d.segmentIds ?? [],
  };
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
