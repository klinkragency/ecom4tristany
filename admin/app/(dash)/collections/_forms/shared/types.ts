// admin/app/(dash)/collections/_forms/shared/types.ts
//
// Mirrors the existing collection API contract. The "type-URL" concept
// follows the discount refonte: a single slug (`manual` / `smart`) that
// drives both the URL and the form being rendered.

import type { CollectionRule, SortOrder } from '@/lib/types';

export type CollectionTypeURL = 'manual' | 'smart';

export const COLLECTION_TYPE_URLS: CollectionTypeURL[] = ['manual', 'smart'];

export function isCollectionTypeURL(s: string): s is CollectionTypeURL {
  return (COLLECTION_TYPE_URLS as string[]).includes(s);
}

// Rule input as it lives in the form (no ID until persisted server-side).
export type RuleInput = {
  // Optional id is only present for rules already persisted in the DB —
  // used by edit-mode diffing to know which rules are old vs newly drafted.
  id?: string;
  field: CollectionRule['field'];
  operator: CollectionRule['operator'];
  value: string;
};

export type CollectionPayload = {
  title: string;
  handle: string;
  descriptionHtml: string;
  isRulesBased: boolean;
  matchAll: boolean;
  sortOrder: SortOrder;
  // Manual collections track an ordered list of product IDs locally until
  // the parent is saved (then it persists via the attach API).
  productIds: string[];
  // Smart collections track an ordered list of rules.
  rules: RuleInput[];
};

export const EMPTY_COLLECTION: CollectionPayload = {
  title: '',
  handle: '',
  descriptionHtml: '',
  isRulesBased: false,
  matchAll: true,
  sortOrder: 'manual',
  productIds: [],
  rules: [],
};

// The server response uses *omitempty* on nullable fields and includes
// metadata (id, createdAt, …) we do not want to round-trip back. Normalize
// against EMPTY_COLLECTION to produce a clean, writable payload.
export type CollectionResponse = {
  id?: string;
  title?: string;
  handle?: string;
  descriptionHtml?: string;
  isRulesBased?: boolean;
  matchAll?: boolean;
  sortOrder?: SortOrder;
  rules?: CollectionRule[];
  products?: { id: string }[];
};

export function normalizeCollection(c: CollectionResponse): CollectionPayload {
  return {
    ...EMPTY_COLLECTION,
    title: c.title ?? '',
    handle: c.handle ?? '',
    descriptionHtml: c.descriptionHtml ?? '',
    isRulesBased: c.isRulesBased ?? false,
    matchAll: c.matchAll ?? true,
    sortOrder: c.sortOrder ?? 'manual',
    productIds: (c.products ?? []).map((p) => p.id),
    rules: (c.rules ?? []).map((r) => ({
      id: r.id,
      field: r.field,
      operator: r.operator,
      value: r.value,
    })),
  };
}

// Map an existing collection to its type-URL. Used by the edit page to
// route to the right form variant.
export function collectionToTypeURL(c: Pick<CollectionPayload, 'isRulesBased'>): CollectionTypeURL {
  return c.isRulesBased ? 'smart' : 'manual';
}

// Initialize a fresh payload pre-filled for the chosen type-URL.
export function initialForType(type: CollectionTypeURL): CollectionPayload {
  switch (type) {
    case 'manual':
      return { ...EMPTY_COLLECTION, isRulesBased: false, sortOrder: 'manual' };
    case 'smart':
      return {
        ...EMPTY_COLLECTION,
        isRulesBased: true,
        sortOrder: 'created_desc',
        // Seed with one empty row so the user has something to edit
        // immediately rather than starting on the "Add condition" button.
        rules: [{ field: 'title', operator: 'contains', value: '' }],
      };
  }
}
