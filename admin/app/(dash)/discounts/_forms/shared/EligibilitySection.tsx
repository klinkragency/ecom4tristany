// admin/app/(dash)/discounts/_forms/shared/EligibilitySection.tsx
'use client';

import { Card, MultiPicker } from '@/components/ui';
import type { DiscountPayload } from './types';

export type Segment = { id: string; name: string };

export function EligibilitySection({
  values,
  onChange,
  segments,
}: {
  values: Pick<DiscountPayload, 'eligibility' | 'segmentIds'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  segments: Segment[];
}) {
  return (
    <Card title="Customer eligibility">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-eligibility"
            checked={values.eligibility === 'all'}
            onChange={() => onChange({ eligibility: 'all' })}
          />
          All customers
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-eligibility"
            checked={values.eligibility === 'segments'}
            onChange={() => onChange({ eligibility: 'segments' })}
          />
          Only customers in specific segments
        </label>
      </div>
      {values.eligibility === 'segments' && (
        <div className="mt-3">
          <MultiPicker
            label="Segments"
            options={segments.map((s) => ({ id: s.id, label: s.name }))}
            selected={values.segmentIds}
            onChange={(ids) => onChange({ segmentIds: ids })}
          />
        </div>
      )}
    </Card>
  );
}
