// admin/app/(dash)/segments/_forms/shared/MatchModeSection.tsx
'use client';

import { Card } from '@/components/ui';
import type { SegmentPayload } from './types';

// Two-radio picker for AND vs OR matching. Lifted into its own card so it's
// visually obvious before the user starts adding rules — the choice changes
// what the rules below mean.
export function MatchModeSection({
  values,
  onChange,
}: {
  values: Pick<SegmentPayload, 'matchAll'>;
  onChange: (patch: Partial<SegmentPayload>) => void;
}) {
  return (
    <Card title="Match">
      <p className="mb-3 text-xs text-stone-500">
        Choose how multiple conditions combine.
      </p>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2 rounded-lg border border-stone-200 p-3 hover:bg-stone-50 cursor-pointer">
          <input
            type="radio"
            name="match-mode"
            checked={values.matchAll}
            onChange={() => onChange({ matchAll: true })}
            className="mt-1"
          />
          <div>
            <div className="font-medium">Match all conditions (AND)</div>
            <div className="text-xs text-stone-500">
              A customer must match every rule below to be in the segment.
            </div>
          </div>
        </label>
        <label className="flex items-start gap-2 rounded-lg border border-stone-200 p-3 hover:bg-stone-50 cursor-pointer">
          <input
            type="radio"
            name="match-mode"
            checked={!values.matchAll}
            onChange={() => onChange({ matchAll: false })}
            className="mt-1"
          />
          <div>
            <div className="font-medium">Match any condition (OR)</div>
            <div className="text-xs text-stone-500">
              A customer matching any single rule is included.
            </div>
          </div>
        </label>
      </div>
    </Card>
  );
}
