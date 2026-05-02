// admin/app/(dash)/collections/_forms/shared/Header.tsx
import { type ReactNode } from 'react';

export function Header({
  illustration,
  title,
  subtitle,
  badge,
}: {
  illustration: ReactNode;
  title: string;
  subtitle: string;
  badge?: ReactNode;
}) {
  return (
    <div
      className="card card-pad flex flex-col items-center gap-4 text-center md:flex-row md:items-center md:gap-6 md:text-left"
      style={{ color: 'var(--color-illustration)' }}
    >
      <div className="shrink-0">{illustration}</div>
      <div className="flex-1" style={{ color: 'var(--color-text)' }}>
        {badge && <div className="mb-1 text-xs font-medium text-stone-500">{badge}</div>}
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        <p className="mt-1 text-sm text-stone-500">{subtitle}</p>
      </div>
    </div>
  );
}
