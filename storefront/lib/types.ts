export type ProductListItem = {
  id: string;
  handle: string;
  title: string;
  status: string;
  vendor: string;
  productType: string;
  updatedAt: string;
  variantCount: number;
  minPriceCents: number;
  maxPriceCents: number;
  primaryImageUrl: string;
};

export type ProductListPage = {
  items: ProductListItem[];
  nextCursor?: string;
};

export type OptionValue = { id: string; position: number; value: string };
export type ProductOption = {
  id: string;
  position: number;
  name: string;
  values: OptionValue[];
};

export type ProductVariant = {
  id: string;
  productId: string;
  sku: string;
  barcode: string;
  priceCents: number;
  compareAtCents?: number | null;
  costCents?: number | null;
  weightGrams: number;
  position: number;
  trackInventory: boolean;
  continueSellingOos: boolean;
  optionValues: Record<string, string>;
};

export type ProductMedia = {
  id: string;
  url: string;
  alt: string;
  position: number;
};

export type Product = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  status: string;
  vendor: string;
  productType: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
  options: ProductOption[];
  variants: ProductVariant[];
  media: ProductMedia[];
};

// formatPrice is the legacy helper. Kept for Server Components that run
// before the CurrencyProvider is mounted (initial SSR) and places where
// the price is always in base currency (order receipts, emails). Client
// components should prefer the usePrice() hook from CurrencyProvider so
// the display follows the active currency choice.
export function formatPrice(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}

export type CollectionListItem = {
  id: string;
  handle: string;
  title: string;
  isRulesBased: boolean;
  productCount: number;
  imageUrl: string;
  updatedAt: string;
};

export type CollectionListPage = {
  items: CollectionListItem[];
  nextCursor?: string;
};

export type CollectionProductRef = {
  id: string;
  handle: string;
  title: string;
  status: string;
  minPriceCents: number;
  maxPriceCents: number;
  primaryImageUrl: string;
};

export type StorefrontCollection = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  imageUrl: string;
  isRulesBased: boolean;
  products: CollectionProductRef[];
};

// ─── Cart ───────────────────────────────────────────────────────────────

export type CartItem = {
  id: string;
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
  addedAt: string;
  available: boolean;
};

export type Cart = {
  id: string;
  customerId?: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
  items: CartItem[];
  subtotalCents: number;
  totalQuantity: number;
  discountCode?: string;
  discountTitle?: string;
  discountCents: number;
  freeShipping: boolean;
  discountError?: string;
};

// ─── Customer account ──────────────────────────────────────────────────

export type CustomerProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  marketingConsent: boolean;
  storeCreditCents: number;
  storeCreditCurrency: string;
};

export type SavedAddress = {
  id: string;
  label: string;
  firstName: string;
  lastName: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
};

export type MyOrderListItem = {
  id: string;
  number: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  itemsCount: number;
};
