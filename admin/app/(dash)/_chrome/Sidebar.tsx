'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import {
  TOP_NAV,
  BOTTOM_NAV,
  isSectionActive,
  isSubActive,
  type NavSection,
} from './nav';

// We persist which parent sections are manually expanded so the sidebar
// remembers user preference across navigations.
const STORAGE_KEY = 'shop.sidebar.expanded';

function readExpanded(): Record<string, boolean> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeExpanded(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* no-op */
  }
}

export default function Sidebar({
  shopName,
  onOpenSearch,
}: {
  shopName: string;
  onOpenSearch: () => void;
}) {
  const pathname = usePathname();
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setManualOpen(readExpanded());
  }, []);

  function setOpen(href: string, value: boolean) {
    setManualOpen((prev) => {
      const next = { ...prev, [href]: value };
      writeExpanded(next);
      return next;
    });
  }

  function sectionOpen(s: NavSection): boolean {
    if (!s.subs?.length) return false;
    const m = manualOpen[s.href];
    if (m !== undefined) return m;
    return isSectionActive(pathname, s); // auto-open if active
  }

  return (
    <aside
      className="flex h-screen flex-col gap-2 px-3 py-4 sticky top-0"
      style={{
        background: 'var(--color-sidebar)',
        color: 'var(--color-sidebar-fg)',
        width: 232,
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-2 mb-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/klinkr-logo.png"
          alt="Klinkr"
          width={28}
          height={28}
          className="h-7 w-7 rounded-md object-contain"
        />
        <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--color-sidebar-fg-strong)' }}>
          {shopName}
        </span>
      </div>

      {/* Search trigger */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors"
        style={{
          background: 'rgba(255,255,255,0.04)',
          color: 'var(--color-sidebar-fg-muted)',
          border: '1px solid var(--color-sidebar-border)',
        }}
      >
        <Search className="h-4 w-4" />
        <span className="flex-1">Search</span>
        <kbd className="rounded bg-white/5 px-1.5 py-[1px] text-[10px] font-mono" style={{ color: 'var(--color-sidebar-fg-muted)' }}>
          ⌘K
        </kbd>
      </button>

      {/* Top navigation */}
      <nav className="mt-2 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {TOP_NAV.map((s) => {
          const open = sectionOpen(s);
          return (
            <SectionRow
              key={s.href}
              section={s}
              pathname={pathname}
              open={open}
              onSetOpen={(v) => setOpen(s.href, v)}
            />
          );
        })}
      </nav>

      {/* Bottom navigation (Settings) */}
      <div className="space-y-0.5 border-t pt-2" style={{ borderColor: 'var(--color-sidebar-border)' }}>
        {BOTTOM_NAV.map((s) => {
          const open = sectionOpen(s);
          return (
            <SectionRow
              key={s.href}
              section={s}
              pathname={pathname}
              open={open}
              onSetOpen={(v) => setOpen(s.href, v)}
            />
          );
        })}
      </div>
    </aside>
  );
}

function SectionRow({
  section,
  pathname,
  open,
  onSetOpen,
}: {
  section: NavSection;
  pathname: string;
  open: boolean;
  onSetOpen: (value: boolean) => void;
}) {
  const Icon = section.icon;
  const hasSubs = !!section.subs?.length;
  const childActive = section.subs?.some((s) => isSubActive(pathname, s)) ?? false;
  const inSection = isSectionActive(pathname, section);
  const onSection = pathname === section.href;
  // Two parent states:
  //   leaf   = strong indicator (sand bar). Used when no sub-item owns the focus.
  //   parent = soft indicator (bg lift only). Used when a sub-item is active so
  //            the bar visually belongs to the sub-item, not the parent.
  const parentState = !inSection ? null : childActive ? 'parent' : 'leaf';

  // Click rules:
  //   - On a different section → navigate (Link handles it) + force-OPEN the
  //     subs so the user immediately sees where they landed.
  //   - On the *same* section route already → toggle (allows collapsing the
  //     row you're currently on without leaving it).
  function handleClick() {
    if (!hasSubs) return;
    if (onSection) onSetOpen(!open);
    else onSetOpen(true);
  }

  return (
    <div>
      <Link
        href={section.href}
        onClick={handleClick}
        className="sb-item"
        data-active={parentState ?? undefined}
        aria-expanded={hasSubs ? open : undefined}
      >
        <Icon className="sb-icon h-4 w-4" />
        <span className="flex-1 truncate">{section.label}</span>
        {hasSubs && <ChevronRight className="sb-chevron" data-open={open} aria-hidden />}
      </Link>

      {hasSubs && (
        <div className="sb-subs" data-open={open}>
          <div>
            <div className="space-y-0.5 pt-0.5">
              {section.subs!.map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className="sb-sub"
                  data-active={isSubActive(pathname, sub)}
                >
                  <span className="truncate">{sub.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
