'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import SettingsRail from './SettingsRail';

const TITLES: Record<string, string> = {
  '/settings': 'Settings',
  '/settings/general': 'General',
  '/settings/currencies': 'Currencies',
  '/settings/taxes': 'Taxes',
  '/settings/shipping': 'Shipping',
  '/settings/locations': 'Locations',
  '/settings/users': 'Users and permissions',
  '/settings/change-password': 'Change password',
  '/settings/audit': 'Audit log',
};

export default function SettingsModal({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  function close() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  // Esc key + lock body scroll while open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefer the most-specific match for the title
  const title =
    Object.entries(TITLES).find(([href]) => pathname === href || pathname.startsWith(href + '/'))?.[1] ?? 'Settings';

  return (
    <div
      className="cp-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6 backdrop-blur-sm"
      onClick={close}
    >
      <div
        className="cp-panel flex h-full max-h-[860px] w-full max-w-[1100px] overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left rail */}
        <aside
          className="flex w-[280px] shrink-0 flex-col border-r"
          style={{
            background: '#faf9f7',
            borderColor: 'var(--color-border)',
          }}
        >
          <header className="flex items-center justify-between px-4 pb-2 pt-4">
            <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          </header>
          <SettingsRail />
        </aside>

        {/* Right panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="flex h-14 items-center justify-between border-b bg-white px-6"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <h3 className="text-sm font-semibold text-stone-900">{title}</h3>
            <button
              onClick={close}
              aria-label="Close settings"
              className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
