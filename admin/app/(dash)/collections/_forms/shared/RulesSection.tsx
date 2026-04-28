// admin/app/(dash)/collections/_forms/shared/RulesSection.tsx
'use client';

import { Card } from '@/components/ui';
import type { CollectionRule } from '@/lib/types';
import type { CollectionPayload, RuleInput } from './types';

const FIELD_LABELS: Record<CollectionRule['field'], string> = {
  title: 'Title',
  vendor: 'Vendor',
  product_type: 'Product type',
  tag: 'Tag',
  price: 'Price (€)',
  inventory: 'Inventory',
  status: 'Status',
};

const OPERATOR_LABELS: Record<CollectionRule['operator'], string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: 'is greater than',
  less_than: 'is less than',
  in_stock: 'is in stock',
  out_of_stock: 'is out of stock',
};

function operatorsFor(field: CollectionRule['field']): CollectionRule['operator'][] {
  switch (field) {
    case 'title':
    case 'vendor':
    case 'product_type':
      return ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'];
    case 'tag':
      return ['equals', 'not_equals'];
    case 'price':
      return ['greater_than', 'less_than', 'equals', 'not_equals'];
    case 'inventory':
      return ['in_stock', 'out_of_stock'];
    case 'status':
      return ['equals', 'not_equals'];
  }
}

function valueless(op: CollectionRule['operator']): boolean {
  return op === 'in_stock' || op === 'out_of_stock';
}

export function RulesSection({
  values,
  onChange,
}: {
  values: Pick<CollectionPayload, 'rules' | 'matchAll'>;
  onChange: (patch: Partial<CollectionPayload>) => void;
}) {
  function patchRule(idx: number, patch: Partial<RuleInput>) {
    const next = values.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange({ rules: next });
  }

  function removeRule(idx: number) {
    onChange({ rules: values.rules.filter((_, i) => i !== idx) });
  }

  function addRule() {
    onChange({
      rules: [
        ...values.rules,
        { field: 'title', operator: 'contains', value: '' },
      ],
    });
  }

  return (
    <Card title="Conditions">
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span className="text-stone-500">Products must match</span>
        <select
          className="select w-auto"
          value={values.matchAll ? 'all' : 'any'}
          onChange={(e) => onChange({ matchAll: e.target.value === 'all' })}
        >
          <option value="all">all conditions</option>
          <option value="any">any condition</option>
        </select>
      </div>

      {values.rules.length === 0 ? (
        <p className="text-sm text-stone-500">
          Add at least one condition for products to appear in this collection.
        </p>
      ) : (
        <ul className="space-y-2">
          {values.rules.map((rule, idx) => {
            const ops = operatorsFor(rule.field);
            // Coerce operator to a valid one for the picked field if the
            // user just changed `field`. Done in render so the next select
            // already shows a sensible default.
            const op = ops.includes(rule.operator) ? rule.operator : ops[0]!;
            return (
              <li
                key={idx}
                className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 text-sm"
              >
                <select
                  className="select w-auto"
                  value={rule.field}
                  onChange={(e) => {
                    const field = e.target.value as CollectionRule['field'];
                    const nextOps = operatorsFor(field);
                    patchRule(idx, {
                      field,
                      operator: nextOps[0]!,
                      // Reset value when switching fields with different
                      // semantics so we don't carry "active" into a price
                      // field, etc.
                      value: '',
                    });
                  }}
                >
                  {Object.entries(FIELD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <select
                  className="select w-auto"
                  value={op}
                  onChange={(e) =>
                    patchRule(idx, {
                      operator: e.target.value as CollectionRule['operator'],
                    })
                  }
                >
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {OPERATOR_LABELS[o]}
                    </option>
                  ))}
                </select>
                {valueless(op) ? (
                  <div />
                ) : (
                  <input
                    className="input text-sm"
                    value={rule.value}
                    onChange={(e) => patchRule(idx, { value: e.target.value })}
                    placeholder={
                      rule.field === 'price'
                        ? 'e.g. 25'
                        : rule.field === 'status'
                          ? 'active / draft / archived'
                          : 'value'
                    }
                  />
                )}
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  aria-label="Remove condition"
                  className="rounded px-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={addRule}
          className="btn btn-secondary"
        >
          + Add condition
        </button>
      </div>
    </Card>
  );
}
