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
