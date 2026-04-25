'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, Search, Sun, Moon, ChevronDown, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui';

type Me = { id: string; email: string; name: string; role: 'owner' | 'admin' | 'staff' };

const ROLE_BADGE: Record<Me['role'], string> = {
  owner: 'bg-stone-900 text-white',
  admin: 'bg-stone-700 text-white',
  staff: 'bg-stone-200 text-stone-800',
};

export default function Topbar({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-white px-4"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <div className="flex-1">
        <SearchTrigger onClick={onOpenSearch} />
      </div>
      <ThemeToggle />
      <NotificationsBell />
      <AccountMenu />
    </header>
  );
}

function SearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full max-w-xl items-center gap-2 rounded-lg border bg-stone-50 px-3 py-1.5 text-left text-sm text-stone-500 transition-colors hover:border-stone-300 hover:bg-white"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <Search className="h-4 w-4 transition-transform group-hover:scale-110" />
      <span className="flex-1">Search anything…</span>
      <kbd className="rounded border bg-white px-1.5 py-[1px] font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
        ⌘K
      </kbd>
    </button>
  );
}

function ThemeToggle() {
  // Light/dark for the *main content area* (sidebar stays dark always).
  // Persisted in localStorage.
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const v = localStorage.getItem('shop.theme') === 'dark';
    setDark(v);
    document.documentElement.classList.toggle('dark', v);
  }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('shop.theme', next ? 'dark' : 'light');
  }
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Switch to light' : 'Switch to dark'}
      className="grid h-9 w-9 place-items-center rounded-lg border text-stone-600 transition-all hover:border-stone-300 hover:text-stone-900"
      style={{ borderColor: 'var(--color-border)' }}
    >
      {dark ? <Sun className="h-4 w-4 transition-transform hover:rotate-45" /> : <Moon className="h-4 w-4 transition-transform hover:-rotate-12" />}
    </button>
  );
}

function NotificationsBell() {
  const [shake, setShake] = useState(false);
  return (
    <button
      onMouseEnter={() => setShake(true)}
      onAnimationEnd={() => setShake(false)}
      aria-label="Notifications"
      className="relative grid h-9 w-9 place-items-center rounded-lg border text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900"
      style={{ borderColor: 'var(--color-border)' }}
    >
      <Bell className={`h-4 w-4 ${shake ? 'animate-bell' : ''}`} />
      <style jsx>{`
        @keyframes bell-shake {
          0%, 100% { transform: rotate(0); }
          20% { transform: rotate(-10deg); }
          40% { transform: rotate(8deg); }
          60% { transform: rotate(-5deg); }
          80% { transform: rotate(3deg); }
        }
        .animate-bell { animation: bell-shake 0.6s ease; }
      `}</style>
    </button>
  );
}

const PERMS: Array<{ label: string; allowed: Me['role'][] }> = [
  { label: 'View everything', allowed: ['owner', 'admin', 'staff'] },
  { label: 'Edit products & orders', allowed: ['owner', 'admin', 'staff'] },
  { label: 'Manage content & discounts', allowed: ['owner', 'admin'] },
  { label: 'Issue refunds', allowed: ['owner', 'admin'] },
  { label: 'Manage admin users', allowed: ['owner'] },
  { label: 'Edit shop settings', allowed: ['owner'] },
  { label: 'Read audit log', allowed: ['owner'] },
];

function AccountMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try { setMe(await api<Me>('/api/admin/me')); } catch { /* logged out */ }
    })();
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!me) return null;

  const initials = (me.name || me.email)
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function logout() {
    try {
      await api('/api/admin/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg border bg-white py-1 pl-1 pr-2 transition-colors hover:border-stone-300"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-stone-900 text-xs font-semibold text-white">
            {initials || '?'}
          </span>
          <span className="hidden text-xs font-medium text-stone-700 sm:block">{me.name || me.email.split('@')[0]}</span>
          <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
        </button>

        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-64 origin-top-right rounded-xl border bg-white p-1.5 shadow-lg cp-panel"
            style={{ borderColor: 'var(--color-border)' }}
          >
            <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{me.name || me.email}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_BADGE[me.role]}`}>
                  {me.role}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-stone-500">{me.email}</div>
            </div>
            <div className="py-1">
              <button
                onClick={() => {
                  setOpen(false);
                  setShowRole(true);
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-50"
              >
                <ShieldCheck className="h-4 w-4 text-stone-500" />
                <span>My permissions</span>
              </button>
              <Link
                href="/settings/change-password"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-50"
              >
                <span className="ml-[2px] h-4 w-4 text-stone-500">⚙</span>
                <span>Change password</span>
              </Link>
              <button
                onClick={logout}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-rose-700 hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {showRole && <RoleModal me={me} onClose={() => setShowRole(false)} />}
    </>
  );
}

function RoleModal({ me, onClose }: { me: Me; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 cp-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl cp-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-stone-900 text-sm font-semibold text-white">
            {(me.name || me.email).split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">{me.name || me.email}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ROLE_BADGE[me.role]}`}>
                {me.role}
              </span>
            </div>
            <div className="truncate text-xs text-stone-500">{me.email}</div>
          </div>
        </div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">What your role can do</h3>
        <ul className="space-y-1.5 text-sm">
          {PERMS.map((p) => {
            const ok = p.allowed.includes(me.role);
            return (
              <li key={p.label} className="flex items-start gap-2">
                <span className={`mt-[1px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-400'}`}>
                  {ok ? '✓' : '–'}
                </span>
                <span className={ok ? 'text-stone-800' : 'text-stone-500'}>{p.label}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-5 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-sm hover:bg-stone-50"
            style={{ borderColor: 'var(--color-border)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
