// admin/app/(dash)/discounts/_forms/shared/ScheduleSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 16);
}

function toIso(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}

export function ScheduleSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'startsAt' | 'endsAt'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  return (
    <Card title="Active dates">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts at">
          <input
            type="datetime-local"
            className="input"
            value={toLocalInput(values.startsAt)}
            onChange={(e) => onChange({ startsAt: toIso(e.target.value) })}
          />
        </Field>
        <Field label="Ends at">
          <input
            type="datetime-local"
            className="input"
            value={toLocalInput(values.endsAt)}
            onChange={(e) => onChange({ endsAt: toIso(e.target.value) })}
          />
        </Field>
      </div>
      {issuesFor(issues, 'endsAt').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
