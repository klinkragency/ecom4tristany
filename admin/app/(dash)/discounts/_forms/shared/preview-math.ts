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
