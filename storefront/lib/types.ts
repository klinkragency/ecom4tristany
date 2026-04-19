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
};
