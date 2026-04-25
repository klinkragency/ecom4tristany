import { type ReactNode } from 'react';

// A standard "panel" used across the admin: rounded-xl card with optional
// title header. `pad` controls inner padding (default true).
export function Card({
  title,
  action,
  pad = true,
  className = '',
  children,
}: {
  title?: ReactNode;
  action?: ReactNode;
  pad?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`card ${pad ? 'card-pad' : ''} ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-sm font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
