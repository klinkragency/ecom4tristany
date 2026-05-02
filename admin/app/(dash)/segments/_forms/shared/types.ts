// admin/app/(dash)/segments/_forms/shared/types.ts
//
// Mirrors the segment API contract on the backend (see
// backend/internal/customer/segments.go). The whitelists below MUST stay in
// sync with the CHECK constraints on customer_segment_rules — adding a new
// field/operator means updating the SQL migration, allowedFields/allowedOps,
// and this file.

export const FIELDS = [
  { v: 'email', l: 'Email', kind: 'text' },
  { v: 'first_name', l: 'First name', kind: 'text' },
  { v: 'last_name', l: 'Last name', kind: 'text' },
  { v: 'country', l: 'Country (any address)', kind: 'text' },
  { v: 'tag', l: 'Tag', kind: 'text' },
  { v: 'marketing_consent', l: 'Marketing consent', kind: 'bool' },
  { v: 'total_spent', l: 'Total spent (cents)', kind: 'number' },
  { v: 'order_count', l: 'Order count', kind: 'number' },
  { v: 'last_order_days', l: 'Days since last order', kind: 'number' },
  { v: 'created_days', l: 'Days since signup', kind: 'number' },
] as const;

export type Field = (typeof FIELDS)[number]['v'];
export type FieldKind = (typeof FIELDS)[number]['kind'];

export type Operator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'greater_than'
  | 'less_than'
  | 'is_true'
  | 'is_false'
  | 'is_null'
  | 'is_not_null';

export const OPS: Record<FieldKind, { v: Operator; l: string }[]> = {
  text: [
    { v: 'equals', l: 'equals' },
    { v: 'not_equals', l: 'not equals' },
    { v: 'contains', l: 'contains' },
    { v: 'not_contains', l: 'does not contain' },
    { v: 'starts_with', l: 'starts with' },
    { v: 'ends_with', l: 'ends with' },
    { v: 'is_null', l: 'is empty' },
    { v: 'is_not_null', l: 'is not empty' },
  ],
  number: [
    { v: 'equals', l: '=' },
    { v: 'not_equals', l: '≠' },
    { v: 'greater_than', l: '>' },
    { v: 'less_than', l: '<' },
    { v: 'is_null', l: 'is null' },
    { v: 'is_not_null', l: 'is not null' },
  ],
  bool: [
    { v: 'is_true', l: 'is true' },
    { v: 'is_false', l: 'is false' },
  ],
};

export function fieldKind(field: string): FieldKind {
  return FIELDS.find((f) => f.v === field)?.kind ?? 'text';
}

// Operators that don't require a value input — the backend rejects a value
// for these and the form should hide the input box.
export function needsValue(op: string): boolean {
  return !['is_null', 'is_not_null', 'is_true', 'is_false'].includes(op);
}

// Rule as it lives in the form. `id` is only present for rules already
// persisted in the DB (carried through edit-mode round-trips).
export type Rule = {
  id?: string;
  field: Field;
  operator: Operator;
  value: string;
  position: number;
};

export type SegmentPayload = {
  name: string;
  description: string;
  matchAll: boolean;
  rules: Rule[];
};

// API response shape (backend uses Segment with extra metadata we discard
// before round-tripping back).
export type SegmentResponse = {
  id?: string;
  name?: string;
  description?: string;
  matchAll?: boolean;
  rules?: Array<{
    id?: string;
    field?: string;
    operator?: string;
    value?: string;
    position?: number;
  }>;
  memberCount?: number;
  createdAt?: string;
  updatedAt?: string;
};

export const EMPTY_SEGMENT: SegmentPayload = {
  name: '',
  description: '',
  matchAll: true,
  // Seed with one empty row so the user has something to edit immediately
  // rather than starting on the bare "Add condition" button. Mirrors the
  // smart-collection form's pattern.
  rules: [
    { field: 'email', operator: 'contains', value: '', position: 0 },
  ],
};

export function normalizeSegment(s: SegmentResponse): SegmentPayload {
  return {
    name: s.name ?? '',
    description: s.description ?? '',
    matchAll: s.matchAll ?? true,
    rules: (s.rules ?? []).map((r, i) => ({
      id: r.id,
      field: (r.field as Field) ?? 'email',
      operator: (r.operator as Operator) ?? 'contains',
      value: r.value ?? '',
      position: r.position ?? i,
    })),
  };
}

// Drop rules where the operator needs a value but the value is blank — the
// backend rejects them, and the live preview should match the eventual
// "saved" state, not the in-progress draft.
export function persistableRules(rules: Rule[]): Rule[] {
  return rules.filter((r) => !needsValue(r.operator) || r.value.trim().length > 0);
}
