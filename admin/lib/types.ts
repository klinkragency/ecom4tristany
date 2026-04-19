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

// ─── Collections ─────────────────────────────────────────────────────────

export type CollectionRule = {
  id: string;
  field: 'title' | 'vendor' | 'product_type' | 'tag' | 'price' | 'inventory' | 'status';
  operator:
    | 'equals'
    | 'not_equals'
    | 'contains'
    | 'not_contains'
    | 'starts_with'
    | 'ends_with'
    | 'greater_than'
    | 'less_than'
    | 'in_stock'
    | 'out_of_stock';
  value: string;
  position: number;
};

export type SortOrder =
  | 'manual'
  | 'best_selling'
  | 'price_asc'
  | 'price_desc'
  | 'alpha_asc'
  | 'alpha_desc'
  | 'created_desc';

export type CollectionProductRef = {
  id: string;
  handle: string;
  title: string;
  status: string;
  minPriceCents: number;
  maxPriceCents: number;
  primaryImageUrl: string;
  position: number;
};

export type Collection = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  imageUrl: string;
  isRulesBased: boolean;
  matchAll: boolean;
  sortOrder: SortOrder;
  seoTitle: string;
  seoDescription: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  rules: CollectionRule[];
  products: CollectionProductRef[];
};

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

// ─── Inventory ──────────────────────────────────────────────────────────

export type Location = {
  id: string;
  name: string;
  isActive: boolean;
  isFulfillment: boolean;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
};

export type InventoryCell = { onHand: number; committed: number; incoming: number };

export type InventoryMatrixLocation = { id: string; name: string; active: boolean };

export type InventoryMatrixVariant = {
  id: string;
  sku: string;
  label: string;
  trackInventory: boolean;
  levels: Record<string, InventoryCell>; // locationId -> cell
  totalOnHand: number;
};

export type InventoryMatrix = {
  productId: string;
  locations: InventoryMatrixLocation[];
  variants: InventoryMatrixVariant[];
};

export type TransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled';

export type TransferItem = {
  variantId: string;
  sku: string;
  label: string;
  quantity: number;
};

export type Transfer = {
  id: string;
  fromLocationId: string;
  toLocationId: string;
  fromName: string;
  toName: string;
  status: TransferStatus;
  note: string;
  createdById: string;
  createdAt: string;
  shippedAt?: string | null;
  receivedAt?: string | null;
  items: TransferItem[];
  totalUnits: number;
};

// ─── Orders ──────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending' | 'paid' | 'partially_paid'
  | 'fulfilled' | 'partially_fulfilled'
  | 'cancelled' | 'refunded' | 'partially_refunded';

export type FinancialStatus =
  | 'pending' | 'authorized' | 'paid' | 'partially_paid'
  | 'refunded' | 'partially_refunded' | 'voided';

export type FulfillmentStatus = 'unfulfilled' | 'partial' | 'fulfilled' | 'restocked';

export type OrderListItem = {
  id: string;
  number: string;
  email: string;
  customerName: string;
  status: OrderStatus;
  financialStatus: FinancialStatus;
  fulfillmentStatus: FulfillmentStatus;
  totalCents: number;
  currency: string;
  createdAt: string;
  itemsCount: number;
};

export type OrderListPage = {
  items: OrderListItem[];
  nextCursor?: string;
  total: number;
};

export type OrderLineItem = {
  id: string;
  variantId?: string | null;
  productId?: string | null;
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string;
  unitPriceCents: number;
  quantity: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

export type OrderAddress = {
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
};

export type OrderPayment = {
  id: string;
  provider: string;
  providerRef: string;
  status: string;
  amountCents: number;
  currency: string;
  brand: string;
  last4: string;
  createdAt: string;
};

export type OrderEvent = {
  id: string;
  kind: string;
  adminId?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type Order = {
  id: string;
  number: string;
  customerId?: string | null;
  customerName: string;
  email: string;
  phone: string;
  currency: string;
  status: OrderStatus;
  financialStatus: FinancialStatus;
  fulfillmentStatus: FulfillmentStatus;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  note: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  cancelledAt?: string | null;
  fulfilledAt?: string | null;
  lineItems: OrderLineItem[];
  shippingAddress?: OrderAddress | null;
  billingAddress?: OrderAddress | null;
  payments: OrderPayment[];
  events: OrderEvent[];
  totalRefundedCents: number;
};

// ─── Customers (admin) ──────────────────────────────────────────────────

export type CustomerAddress = {
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

export type CustomerListItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  orderCount: number;
  totalSpentCents: number;
  currency: string;
  lastOrderAt?: string | null;
  createdAt: string;
  tags: string[];
};

export type CustomerListPage = {
  items: CustomerListItem[];
  total: number;
};

export type LedgerEntry = {
  id: string;
  deltaCents: number;
  reason: string;
  note: string;
  orderId?: string | null;
  createdAt: string;
};

export type CustomerDetail = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  marketingConsent: boolean;
  note: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  orderCount: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastOrderAt?: string | null;
  storeCreditCents: number;
  storeCreditCurrency: string;
  addresses: CustomerAddress[];
  recentOrders: {
    id: string;
    number: string;
    status: string;
    financialStatus: FinancialStatus;
    fulfillmentStatus: FulfillmentStatus;
    totalCents: number;
    currency: string;
    createdAt: string;
    itemsCount: number;
  }[];
  ledgerEntries: LedgerEntry[];
};
