// admin/app/(dash)/discounts/_forms/shared/FieldHint.tsx
import { type ReactNode } from 'react';

type Variant = 'error' | 'warning' | 'info';

const VARIANT_CLASS: Record<Variant, string> = {
  error: 'text-red-600',
  warning: 'text-amber-700',
  info: 'text-stone-500',
};

const ICON: Record<Variant, string> = {
  error: '⚠',
  warning: '⚠',
  info: 'ℹ',
};

export function FieldHint({
  variant,
  children,
}: {
  variant: Variant;
  children: ReactNode;
}) {
  return (
    <p className={`mt-1 text-xs ${VARIANT_CLASS[variant]}`}>
      <span className="mr-1">{ICON[variant]}</span>
      {children}
    </p>
  );
}
