// admin/app/(dash)/discounts/_forms/shared/validation.ts
import type { DiscountPayload, TypeURL } from './types';

export type Issue = {
  field: string;
  variant: 'error' | 'warning';
  message: string;
};

const ALPHANUM_CODE = /^[A-Z0-9]+$/;

// Returns all issues found. Errors block save; warnings don't.
export function validate(v: DiscountPayload, type: TypeURL): Issue[] {
  const issues: Issue[] = [];

  if (!v.title.trim()) {
    issues.push({ field: 'title', variant: 'error', message: 'A title is required' });
  }

  if (v.code.length > 0) {
    if (v.code.length > 40) {
      issues.push({ field: 'code', variant: 'error', message: 'Maximum 40 characters' });
    } else if (!ALPHANUM_CODE.test(v.code)) {
      issues.push({ field: 'code', variant: 'error', message: 'Letters and digits only, no spaces' });
    }
  }

  // Value rules vary by type.
  if (type === 'amount-off-order' || type === 'amount-off-products') {
    if (v.kind === 'percentage') {
      if (v.valuePercent == null || v.valuePercent <= 0) {
        issues.push({ field: 'valuePercent', variant: 'error', message: 'Percentage must be greater than 0' });
      } else if (v.valuePercent > 100) {
        issues.push({ field: 'valuePercent', variant: 'error', message: 'Maximum 100%' });
      } else if (v.valuePercent >= 50 && v.minSubtotalCents === 0) {
        issues.push({
          field: 'valuePercent',
          variant: 'warning',
          message: 'Big discount with no minimum — set a minimum to protect yourself',
        });
      }
    } else if (v.kind === 'amount') {
      if (v.valueCents == null || v.valueCents <= 0) {
        issues.push({ field: 'valueCents', variant: 'error', message: 'Amount must be greater than 0' });
      }
    }
  }

  // Schedule rules
  if (v.startsAt && v.endsAt && new Date(v.endsAt) < new Date(v.startsAt)) {
    issues.push({ field: 'endsAt', variant: 'error', message: 'End date is before start date' });
  }
  if (v.endsAt && new Date(v.endsAt) < new Date()) {
    issues.push({
      field: 'endsAt',
      variant: 'warning',
      message: 'This date is in the past — the discount will be inactive',
    });
  }

  // Type-specific applies-to checks
  if (type === 'amount-off-products') {
    if (v.scope === 'products' && v.productIds.length === 0) {
      issues.push({
        field: 'productIds',
        variant: 'warning',
        message: 'No products selected — discount will have no effect',
      });
    }
    if (v.scope === 'collections' && v.collectionIds.length === 0) {
      issues.push({
        field: 'collectionIds',
        variant: 'warning',
        message: 'No collections selected — discount will have no effect',
      });
    }
  }

  // BOGO rules
  if (type === 'buy-x-get-y') {
    if ((v.bogoBuyQuantity ?? 0) <= 0) {
      issues.push({ field: 'bogoBuyQuantity', variant: 'error', message: 'Must be at least 1' });
    }
    if ((v.bogoGetQuantity ?? 0) <= 0) {
      issues.push({ field: 'bogoGetQuantity', variant: 'error', message: 'Must be at least 1' });
    }
    if (v.bogoGetDiscountPercent != null) {
      if (v.bogoGetDiscountPercent < 0 || v.bogoGetDiscountPercent > 100) {
        issues.push({ field: 'bogoGetDiscountPercent', variant: 'error', message: 'Must be 0–100%' });
      }
    }
  }

  return issues;
}

// hasErrors blocks save when true.
export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.variant === 'error');
}

// issuesFor returns only the issues attached to a given field.
export function issuesFor(issues: Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field);
}
