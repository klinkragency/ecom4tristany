// admin/app/(dash)/segments/_forms/shared/BasicsSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { SegmentPayload } from './types';

export function BasicsSection({
  values,
  onChange,
}: {
  values: Pick<SegmentPayload, 'name' | 'description'>;
  onChange: (patch: Partial<SegmentPayload>) => void;
}) {
  return (
    <Card title="Basics">
      <div className="space-y-3">
        <Field label="Name" required>
          <input
            className="input"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="VIP customers, Lapsed buyers, Newsletter subscribers, …"
          />
        </Field>

        <Field
          label="Description"
          hint="Optional — a short note so teammates know what this segment is for."
        >
          <input
            className="input"
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Customers who have spent over €500 in the last year"
          />
        </Field>
      </div>
    </Card>
  );
}
