// admin/app/(dash)/discounts/_forms/shared/ValueSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function ValueSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'kind' | 'valuePercent' | 'valueCents'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  const isPercent = values.kind === 'percentage';
  return (
    <Card title="Value">
      <div className="flex gap-2 mb-3">
        <button
          type="button"
          onClick={() => onChange({ kind: 'percentage', valuePercent: values.valuePercent ?? 10, valueCents: null })}
          className={`btn flex-1 ${isPercent ? 'btn-primary' : ''}`}
        >
          Percentage
        </button>
        <button
          type="button"
          onClick={() => onChange({ kind: 'amount', valueCents: values.valueCents ?? 500, valuePercent: null })}
          className={`btn flex-1 ${!isPercent ? 'btn-primary' : ''}`}
        >
          Fixed amount
        </button>
      </div>

      {isPercent ? (
        <Field label="Percentage off">
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              className="input pr-8"
              value={values.valuePercent ?? ''}
              onChange={(e) =>
                onChange({ valuePercent: e.target.value === '' ? null : Number(e.target.value) })
              }
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">%</span>
          </div>
        </Field>
      ) : (
        <Field label="Amount off">
          <div className="relative">
            <input
              type="number"
              step="0.01"
              min={0}
              className="input pl-8"
              value={values.valueCents == null ? '' : (values.valueCents / 100).toFixed(2)}
              onChange={(e) =>
                onChange({
                  valueCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100),
                })
              }
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">€</span>
          </div>
        </Field>
      )}

      {issuesFor(issues, isPercent ? 'valuePercent' : 'valueCents').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
