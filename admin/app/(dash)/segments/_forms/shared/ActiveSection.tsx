// admin/app/(dash)/segments/_forms/shared/ActiveSection.tsx
'use client';

// Sticky bottom save bar. Segments don't have an `active` flag in the data
// model, so this is a slimmer version of the discounts/collections
// equivalent — just save/cancel.

export function ActiveSection({
  saving,
  saveLabel,
  onSave,
  onCancel,
  disabled,
}: {
  saving: boolean;
  saveLabel: string;
  onSave: () => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-stone-200 bg-stone-50 px-3 py-3 -mx-3 rounded-b-xl">
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="btn btn-secondary"
        >
          Cancel
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="btn btn-primary"
      >
        {saving ? 'Saving…' : saveLabel}
      </button>
    </div>
  );
}
