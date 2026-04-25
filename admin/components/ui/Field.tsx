import { type ReactNode } from 'react';

// A labeled form row. Wraps the child input in a <label> for implicit
// association — simpler than maintaining htmlFor/id pairs everywhere.
export function Field({
  label,
  required,
  hint,
  className = '',
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </span>
      {children}
      {hint && <span className="help">{hint}</span>}
    </label>
  );
}
