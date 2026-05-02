// admin/app/(dash)/discounts/_forms/shared/ActiveSection.tsx
'use client';

import { Card } from '@/components/ui';
import type { DiscountPayload } from './types';

export function ActiveSection({
  values,
  onChange,
  saving,
  saveLabel,
  onSave,
  disabled,
}: {
  values: Pick<DiscountPayload, 'active'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  disabled: boolean;
}) {
  return (
    <>
      <Card title="Status">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values.active}
            onChange={(e) => onChange({ active: e.target.checked })}
          />
          Active (live for customers)
        </label>
      </Card>

      <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-3 py-3 -mx-3 rounded-b-xl">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || disabled}
          className="btn btn-primary"
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </>
  );
}
