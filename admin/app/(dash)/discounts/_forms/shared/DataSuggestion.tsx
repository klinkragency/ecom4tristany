// admin/app/(dash)/discounts/_forms/shared/DataSuggestion.tsx
import { type ReactNode } from 'react';

// Renders a "💡 hint" with an optional action button. Returns null if the
// caller passes `show={false}` so we can chain without ternaries upstream.
export function DataSuggestion({
  show = true,
  children,
  action,
}: {
  show?: boolean;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  if (!show) return null;
  return (
    <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-stone-100 px-3 py-2 text-xs text-stone-600">
      <span>💡 {children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="text-stone-900 font-medium underline-offset-2 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
