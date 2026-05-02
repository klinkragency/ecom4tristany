// admin/app/(dash)/collections/_forms/shared/SortOrderSection.tsx
'use client';

import { Card, Field, Select } from '@/components/ui';
import type { SortOrder } from '@/lib/types';
import type { CollectionPayload } from './types';

const OPTIONS: { value: SortOrder; label: string; manualOnly?: boolean }[] = [
  { value: 'manual', label: 'Manual — drag to reorder', manualOnly: true },
  { value: 'created_desc', label: 'Newest first' },
  { value: 'alpha_asc', label: 'Alphabetical (A → Z)' },
  { value: 'alpha_desc', label: 'Alphabetical (Z → A)' },
  { value: 'price_asc', label: 'Price (low → high)' },
  { value: 'price_desc', label: 'Price (high → low)' },
  { value: 'best_selling', label: 'Best selling' },
];

export function SortOrderSection({
  values,
  onChange,
  isRulesBased,
}: {
  values: Pick<CollectionPayload, 'sortOrder'>;
  onChange: (patch: Partial<CollectionPayload>) => void;
  isRulesBased: boolean;
}) {
  return (
    <Card title="Sort order">
      <Field
        label="How should products be ordered on the storefront?"
        hint={
          isRulesBased
            ? 'Manual ordering is unavailable for smart collections — products are matched dynamically.'
            : 'Pick "Manual" to control the exact order yourself; pick anything else to let the system order them.'
        }
      >
        <Select<SortOrder>
          ariaLabel="Sort order"
          value={values.sortOrder}
          onChange={(v) => onChange({ sortOrder: v })}
          options={OPTIONS.filter((o) => !o.manualOnly || !isRulesBased).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
      </Field>
    </Card>
  );
}
