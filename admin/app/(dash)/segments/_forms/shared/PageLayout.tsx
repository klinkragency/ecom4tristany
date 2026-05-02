// admin/app/(dash)/segments/_forms/shared/PageLayout.tsx
import { type ReactNode } from 'react';

// Two-column shell: form on the left (max-w-3xl), sticky preview on the
// right (w-80). Mirrors the discounts/collections layout for visual
// consistency across the admin.
export function PageLayout({
  preview,
  children,
}: {
  preview: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex-1 max-w-3xl space-y-4">{children}</div>
      <aside className="w-full lg:w-80 lg:sticky lg:top-24">{preview}</aside>
    </div>
  );
}
