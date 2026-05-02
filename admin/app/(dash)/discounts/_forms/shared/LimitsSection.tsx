// admin/app/(dash)/discounts/_forms/shared/LimitsSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { DataSuggestion } from './DataSuggestion';

export type Suggestions = {
  averageOrderValueCents: number;
  totalCustomers: number;
} | null;

export function LimitsSection({
  values,
  onChange,
  suggestions,
}: {
  values: Pick<DiscountPayload, 'minSubtotalCents' | 'usageLimit' | 'usageLimitPerCustomer'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  suggestions: Suggestions;
}) {
  // Suggested minimum: 60% of average order value, rounded down to the
  // nearest €5. Only meaningful when avg > €0.
  const suggestedMinCents =
    suggestions && suggestions.averageOrderValueCents > 0
      ? Math.floor((suggestions.averageOrderValueCents * 0.6) / 500) * 500
      : 0;

  return (
    <Card title="Limits">
      <Field label="Minimum order subtotal (€)">
        <input
          type="number"
          step="0.01"
          min={0}
          className="input"
          value={(values.minSubtotalCents / 100).toFixed(2)}
          onChange={(e) =>
            onChange({ minSubtotalCents: Math.round(Number(e.target.value) * 100) })
          }
        />
      </Field>
      <DataSuggestion
        show={suggestedMinCents > 0 && values.minSubtotalCents !== suggestedMinCents}
        action={{
          label: `Apply €${(suggestedMinCents / 100).toFixed(0)}`,
          onClick: () => onChange({ minSubtotalCents: suggestedMinCents }),
        }}
      >
        Average order: €
        {((suggestions?.averageOrderValueCents ?? 0) / 100).toFixed(2)} — suggested minimum: €
        {(suggestedMinCents / 100).toFixed(0)}
      </DataSuggestion>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <Field label="Total uses (empty = unlimited)">
          <input
            type="number"
            min={0}
            className="input"
            value={values.usageLimit ?? ''}
            onChange={(e) =>
              onChange({ usageLimit: e.target.value === '' ? null : Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Uses per customer (empty = unlimited)">
          <input
            type="number"
            min={0}
            className="input"
            value={values.usageLimitPerCustomer ?? ''}
            onChange={(e) =>
              onChange({
                usageLimitPerCustomer: e.target.value === '' ? null : Number(e.target.value),
              })
            }
          />
        </Field>
      </div>
      <DataSuggestion show={!!suggestions && suggestions.totalCustomers > 0}>
        {suggestions?.totalCustomers ?? 0} customers in your shop
      </DataSuggestion>
    </Card>
  );
}
