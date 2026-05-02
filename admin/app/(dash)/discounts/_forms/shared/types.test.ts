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
