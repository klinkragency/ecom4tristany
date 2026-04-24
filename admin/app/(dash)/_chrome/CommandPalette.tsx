'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  ArrowRight,
  ShoppingBag,
  Package,
  Users,
  Tag,
  FileText,
  BarChart3,
  Settings,
  Plus,
  Clock,
  ArrowUpRight,
  CornerDownLeft,
  type LucideIcon,
} from 'lucide-react';
import { TOP_NAV, BOTTOM_NAV } from './nav';
import { api } from '@/lib/api';

type Hit = {
  kind: 'product' | 'customer' | 'order';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type Item = {
  id: string;            // unique key
  group: string;         // section header
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  href: string;
  kind?: Hit['kind'] | 'nav' | 'action' | 'recent';
};

const RECENTS_KEY = 'shop.cp.recents';
const RECENTS_MAX = 5;

function readRecents(): Item[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function pushRecent(it: Item) {
  try {
    const cur = readRecents().filter((r) => r.id !== it.id);
    const next = [{ ...it, group: 'Recents', kind: 'recent' as const }, ...cur].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* no-op */
  }
}

const KIND_META: Record<string, { icon: LucideIcon; group: string }> = {
  product: { icon: Package, group: 'Products' },
  customer: { icon: Users, group: 'Customers' },
  order: { icon: ShoppingBag, group: 'Orders' },
};

const QUICK_ACTIONS: Item[] = [
  { id: 'qa-new-product', group: 'Quick actions', icon: Plus, title: 'Create product', href: '/products/new', kind: 'action' },
  { id: 'qa-new-discount', group: 'Quick actions', icon: Tag, title: 'Create discount', href: '/discounts/new', kind: 'action' },
  { id: 'qa-new-page', group: 'Quick actions', icon: FileText, title: 'Create page', href: '/content/pages/new', kind: 'action' },
];

function navItems(): Item[] {
  const out: Item[] = [];
  for (const s of [...TOP_NAV, ...BOTTOM_NAV]) {
    out.push({ id: `nav-${s.href}`, group: 'Navigation', icon: s.icon, title: s.label, href: s.href, kind: 'nav' });
    for (const sub of s.subs ?? []) {
      out.push({
        id: `nav-${sub.href}`,
        group: 'Navigation',
        icon: s.icon,
        title: sub.label,
        subtitle: s.label,
        href: sub.href,
        kind: 'nav',
      });
    }
  }
  return out;
}

function fuzzyMatch(item: Item, q: string): boolean {
  if (!q) return true;
  const hay = (item.title + ' ' + (item.subtitle ?? '') + ' ' + item.group).toLowerCase();
  const needle = q.toLowerCase();
  // simple subsequence match — every char of needle appears in order in hay.
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [recents, setRecents] = useState<Item[]>([]);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open: focus input, reset state
  useEffect(() => {
    if (!open) return;
    setQ('');
    setHighlight(0);
    setRecents(readRecents());
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Esc / arrows
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Live search debounce
  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await api<{ items: Hit[] }>(
          `/api/admin/search?q=${encodeURIComponent(term)}`,
          { signal: ctrl.signal },
        );
        setHits(r.items);
      } catch {
        /* aborted or failed; ignore */
      }
    }, 150);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [q, open]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim();
    const liveItems: Item[] = hits.map((h) => ({
      id: `${h.kind}-${h.id}`,
      group: KIND_META[h.kind].group,
      icon: KIND_META[h.kind].icon,
      title: h.title,
      subtitle: h.subtitle,
      href: h.href,
      kind: h.kind,
    }));

    if (!term) {
      // Empty query: recents → quick actions → navigation
      return [...recents, ...QUICK_ACTIONS, ...navItems()];
    }

    const navMatched = navItems().filter((n) => fuzzyMatch(n, term));
    const actionMatched = QUICK_ACTIONS.filter((a) => fuzzyMatch(a, term));
    return [...liveItems, ...actionMatched, ...navMatched];
  }, [q, hits, recents]);

  // Group items in render order
  const grouped = useMemo(() => {
    const out: Array<{ group: string; items: Item[] }> = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && last.group === it.group) last.items.push(it);
      else out.push({ group: it.group, items: [it] });
    }
    return out;
  }, [items]);

  // Reset highlight when items change
  useEffect(() => {
    setHighlight(0);
  }, [items.length]);

  function go(it: Item) {
    pushRecent(it);
    onClose();
    router.push(it.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[highlight];
      if (it) go(it);
    }
  }

  if (!open) return null;

  // Compute the global index of each item so highlight syncs across groups
  let globalIdx = -1;

  return (
    <div
      className="cp-backdrop fixed inset-0 z-50 grid place-items-start bg-black/40 px-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="cp-panel w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-2xl"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}>
          <Search className="h-4 w-4 text-stone-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search products, customers, orders, or jump anywhere…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-stone-400"
          />
          <kbd className="rounded border bg-stone-50 px-1.5 py-[1px] font-mono text-[10px] text-stone-500" style={{ borderColor: 'var(--color-border)' }}>
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-1.5">
          {grouped.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-stone-500">No matches.</div>
          )}
          {grouped.map((g) => (
            <div key={g.group} className="mb-1.5 last:mb-0">
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                {g.group}
              </div>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  globalIdx += 1;
                  const idx = globalIdx;
                  const Icon = it.icon;
                  const active = idx === highlight;
                  return (
                    <button
                      key={it.id}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => go(it)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        active ? 'bg-stone-100' : 'hover:bg-stone-50'
                      }`}
                    >
                      <span className={`grid h-7 w-7 place-items-center rounded-md ${active ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-600'} transition-colors`}>
                        {it.kind === 'recent' ? <Clock className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-stone-900">{it.title}</div>
                        {it.subtitle && (
                          <div className="truncate text-xs text-stone-500">{it.subtitle}</div>
                        )}
                      </div>
                      {it.kind === 'action' ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-stone-400" />
                      ) : (
                        <ArrowRight className={`h-3.5 w-3.5 transition-opacity ${active ? 'opacity-100' : 'opacity-0'} text-stone-400`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 border-t bg-stone-50 px-3 py-2 text-[11px] text-stone-500"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border bg-white px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>↑</kbd>
              <kbd className="rounded border bg-white px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>↓</kbd>
              navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border bg-white px-1 font-mono text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
                <CornerDownLeft className="inline h-2.5 w-2.5" />
              </kbd>
              open
            </span>
          </div>
          <span>{items.length} result{items.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
