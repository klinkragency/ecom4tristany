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
