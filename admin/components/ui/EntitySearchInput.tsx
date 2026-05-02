'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';

export type SearchHit = {
  kind: 'product' | 'customer' | 'order';
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type SearchResponse = { items: SearchHit[] };

const KIND_LABELS: Record<SearchHit['kind'], string> = {
  product: 'Products',
  customer: 'Customers',
  order: 'Orders',
};

// EntitySearchInput is a search input with a debounced autocomplete popover
// that calls the admin /api/admin/search endpoint. It mirrors the visual
// language of <Select>: rounded-lg trigger, shadow-lg popover, hover/active
// stone-50 rows. Use on high-cardinality list pages where users may want to
// jump straight to a record instead of paging.
export function EntitySearchInput({
  kinds,
  placeholder = 'Search…',
  onSelect,
  size = 'md',
  autoFocus = false,
  className = '',
}: {
  kinds?: Array<SearchHit['kind']>;
  placeholder?: string;
  onSelect?: (hit: SearchHit) => void;
  size?: 'sm' | 'md';
  autoFocus?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);
  const listboxId = useId();
  const optionIdPrefix = useId();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Filter results to the requested kinds, then group them in stable order.
  const filtered = useMemo(() => {
    if (!kinds || kinds.length === 0) return hits;
    const allow = new Set(kinds);
    return hits.filter((h) => allow.has(h.kind));
  }, [hits, kinds]);

  const grouped = useMemo(() => {
    // Preserve the order of the first occurrence per kind so the popover
    // sections don't reshuffle as the user types.
    const order: SearchHit['kind'][] = [];
    const buckets = new Map<SearchHit['kind'], SearchHit[]>();
    for (const hit of filtered) {
      if (!buckets.has(hit.kind)) {
        buckets.set(hit.kind, []);
        order.push(hit.kind);
      }
      buckets.get(hit.kind)!.push(hit);
    }
    return order.map((kind) => ({ kind, items: buckets.get(kind)! }));
  }, [filtered]);

  // Show kind headers only when more than one kind is in play.
  const showHeaders = (kinds?.length ?? 0) !== 1 && grouped.length > 1;

  // Debounced fetch: 250ms after the latest keystroke, fire one request and
  // ignore the response if a newer one has been issued meanwhile.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = ++reqIdRef.current;
    const t = window.setTimeout(async () => {
      try {
        const res = await api<SearchResponse>(
          `/api/admin/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (id === reqIdRef.current) {
          setHits(res.items ?? []);
          setLoading(false);
        }
      } catch {
        if (id === reqIdRef.current) {
          setHits([]);
          setLoading(false);
        }
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // Whenever the result set shrinks, snap activeIndex back into bounds.
  useEffect(() => {
    if (filtered.length === 0) {
      setActiveIndex(-1);
    } else if (activeIndex >= filtered.length) {
      setActiveIndex(0);
    } else if (activeIndex < 0 && open) {
      setActiveIndex(0);
    }
  }, [filtered.length, open, activeIndex]);

  // Outside click closes (Escape is handled in onKeyDown so we can also
  // restore focus to the input).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(`${optionIdPrefix}-${activeIndex}`)}`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, optionIdPrefix]);

  function commit(hit: SearchHit) {
    if (onSelect) onSelect(hit);
    else router.push(hit.href);
    setOpen(false);
    setQuery('');
    setHits([]);
  }

  function moveActive(delta: number) {
    if (filtered.length === 0) return;
    const next =
      activeIndex < 0
        ? delta > 0
          ? 0
          : filtered.length - 1
        : (activeIndex + delta + filtered.length) % filtered.length;
    setActiveIndex(next);
  }

  function onKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      moveActive(-1);
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && filtered[activeIndex]) {
        e.preventDefault();
        commit(filtered[activeIndex]!);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        inputRef.current?.focus();
      }
    }
  }

  const sizeClass =
    size === 'sm' ? 'pl-8 pr-3 py-1.5 text-xs' : 'pl-9 pr-3 py-2 text-sm';
  const iconSize = size === 'sm' ? 14 : 16;
  const iconLeft = size === 'sm' ? 'left-2.5' : 'left-3';

  const trimmed = query.trim();
  const showPopover =
    open && trimmed.length >= 2 && (loading || filtered.length >= 0);

  // Build a flat index map for assigning sequential row ids when grouping.
  let runningIndex = -1;

  return (
    <div ref={wrapRef} className={`relative inline-block w-full ${className}`}>
      <div className="relative">
        <Search
          size={iconSize}
          className={`pointer-events-none absolute top-1/2 ${iconLeft} -translate-y-1/2 text-stone-400`}
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={showPopover}
          aria-controls={showPopover ? listboxId : undefined}
          aria-activedescendant={
            showPopover && activeIndex >= 0
              ? `${optionIdPrefix}-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (trimmed.length >= 2) setOpen(true);
          }}
          onKeyDown={onKey}
          className={`w-full rounded-lg border border-stone-200 bg-white transition-colors focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300/40 ${sizeClass}`}
        />
      </div>

      {showPopover && (
        <div
          id={listboxId}
          ref={listRef}
          role="listbox"
          className="cp-select-pop absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          {loading && filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-500">Searching…</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-500">No matches</div>
          ) : (
            <>
              {grouped.map((group) => (
                <div key={group.kind}>
                  {showHeaders && (
                    <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
                      {KIND_LABELS[group.kind]}
                    </div>
                  )}
                  {group.items.map((hit) => {
                    runningIndex += 1;
                    const i = runningIndex;
                    const isActive = i === activeIndex;
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        id={`${optionIdPrefix}-${i}`}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIndex(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => commit(hit)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                          isActive ? 'bg-stone-50' : 'hover:bg-stone-50'
                        }`}
                      >
                        <span className="truncate font-medium text-stone-900">
                          {hit.title}
                        </span>
                        <span className="flex-shrink-0 truncate text-xs text-stone-500">
                          {hit.subtitle}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {loading && (
                <div className="border-t border-stone-100 px-3 py-1.5 text-xs text-stone-400">
                  Searching…
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
