export type ProductStatus = 'draft' | 'active' | 'archived';

export type ProductListItem = {
  id: string;
  handle: string;
  title: string;
  status: ProductStatus;
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
  optionValues: Record<string, string>; // optionId -> valueId
};

export type ProductMedia = {
  id: string;
  productId: string;
  variantId?: string | null;
  kind: 'image' | 'video' | 'model3d';
  objectKey: string;
  url: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  bytes?: number | null;
  mime: string;
  position: number;
};

export type Product = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  status: ProductStatus;
  vendor: string;
  productType: string;
  taxStatus: 'taxable' | 'non_taxable';
  weightGrams: number;
  hsCode: string;
  seoTitle: string;
  seoDescription: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  options: ProductOption[];
  variants: ProductVariant[];
  media: ProductMedia[];
};

export function formatPrice(cents: number, currency = 'EUR'): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(cents / 100);
}
