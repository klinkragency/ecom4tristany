// admin/app/(dash)/discounts/_forms/shared/validation.test.ts
import { describe, expect, test } from 'bun:test';
import { validate, hasErrors, issuesFor } from './validation';
import { initialForType } from './types';

describe('validate', () => {
  test('empty title is an error', () => {
    const v = initialForType('amount-off-order');
    const issues = validate(v, 'amount-off-order');
    expect(issuesFor(issues, 'title')).toEqual([
      { field: 'title', variant: 'error', message: 'A title is required' },
    ]);
  });

  test('valid amount-off-order has no errors', () => {
    const v = { ...initialForType('amount-off-order'), title: 'Test' };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(false);
  });

  test('code with spaces is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', code: 'BAD CODE' };
    expect(issuesFor(validate(v, 'amount-off-order'), 'code')).toHaveLength(1);
  });

  test('percentage > 100 is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', valuePercent: 150 };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(true);
  });

  test('50% with no minimum is a warning, not an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', valuePercent: 50, minSubtotalCents: 0 };
    const issues = validate(v, 'amount-off-order');
    expect(hasErrors(issues)).toBe(false);
    expect(issuesFor(issues, 'valuePercent')).toEqual([
      expect.objectContaining({ variant: 'warning' }),
    ]);
  });

  test('end before start is an error', () => {
    const v = {
      ...initialForType('amount-off-order'),
      title: 'X',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-05-01T00:00:00Z',
    };
    expect(hasErrors(validate(v, 'amount-off-order'))).toBe(true);
  });

  test('amount-off-products with empty productIds is warning', () => {
    const v = { ...initialForType('amount-off-products'), title: 'X', productIds: [] };
    const issues = validate(v, 'amount-off-products');
    expect(hasErrors(issues)).toBe(false);
    expect(issuesFor(issues, 'productIds')).toHaveLength(1);
  });

  test('BOGO buy qty 0 is an error', () => {
    const v = { ...initialForType('buy-x-get-y'), title: 'X', bogoBuyQuantity: 0 };
    expect(hasErrors(validate(v, 'buy-x-get-y'))).toBe(true);
  });

  test('negative minSubtotalCents is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', minSubtotalCents: -100 };
    const issues = validate(v, 'amount-off-order');
    expect(issuesFor(issues, 'minSubtotalCents')).toEqual([
      { field: 'minSubtotalCents', variant: 'error', message: 'Minimum cannot be negative' },
    ]);
  });

  test('negative usageLimit is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', usageLimit: -1 };
    const issues = validate(v, 'amount-off-order');
    expect(issuesFor(issues, 'usageLimit')).toEqual([
      { field: 'usageLimit', variant: 'error', message: 'Total uses cannot be negative' },
    ]);
  });

  test('negative usageLimitPerCustomer is an error', () => {
    const v = { ...initialForType('amount-off-order'), title: 'X', usageLimitPerCustomer: -5 };
    const issues = validate(v, 'amount-off-order');
    expect(issuesFor(issues, 'usageLimitPerCustomer')).toEqual([
      { field: 'usageLimitPerCustomer', variant: 'error', message: 'Per-customer uses cannot be negative' },
    ]);
  });
});
