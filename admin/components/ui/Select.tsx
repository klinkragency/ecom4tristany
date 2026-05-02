'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  // Small muted text shown right-aligned in the option row.
  hint?: string;
  disabled?: boolean;
};

// A hand-rolled <select> replacement that matches the rest of our UI primitives
// (Modal, Card, RowActionsMenu). It renders a button trigger styled like .input
// plus a popover listbox; supports keyboard navigation, optional search, and
// "all/empty" sentinel options. Drop-in compatible with the previous native
// <select> calls — same value/onChange shape.
export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled = false,
  size = 'md',
  align = 'start',
  searchable = false,
  className = '',
  ariaLabel,
}: {
  value: T | '';
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  align?: 'start' | 'end';
  searchable?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const selected = options.find((o) => o.value === value);

  // First enabled index — used as the initial highlight when opening.
  const firstEnabled = (list: SelectOption<T>[]) =>
    list.findIndex((o) => !o.disabled);
  const lastEnabled = (list: SelectOption<T>[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i]!.disabled) return i;
    }
    return -1;
  };

  // Outside click + Escape close.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // When opening: reset query, highlight selected (or first enabled), focus search.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const list = options;
    const selIdx = list.findIndex((o) => o.value === value && !o.disabled);
    setActiveIndex(selIdx >= 0 ? selIdx : firstEnabled(list));
    if (searchable) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open, options, searchable, value]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(`${optionIdPrefix}-${activeIndex}`)}`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, optionIdPrefix]);

  // If the filter shrinks the list below activeIndex, snap back to first enabled.
  useEffect(() => {
    if (!open) return;
    if (activeIndex >= filtered.length || filtered[activeIndex]?.disabled) {
      setActiveIndex(firstEnabled(filtered));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length]);

  function commit(opt: SelectOption<T>) {
    if (opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    if (filtered.length === 0) return;
    let i = activeIndex;
    for (let step = 0; step < filtered.length; step++) {
      i = (i + delta + filtered.length) % filtered.length;
      if (!filtered[i]!.disabled) {
        setActiveIndex(i);
        return;
      }
    }
  }

  function onTriggerKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(firstEnabled(filtered)); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIndex(lastEnabled(filtered)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    } else if (e.key === 'Tab') {
      // Tab inside popover closes it but lets focus move naturally.
      setOpen(false);
    }
  }

  function onSearchKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(firstEnabled(filtered)); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIndex(lastEnabled(filtered)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) commit(opt);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  const sizeClass =
    size === 'sm'
      ? 'px-2.5 py-1.5 text-xs'
      : 'px-3 py-2 text-sm';

  const triggerLabel = selected ? selected.label : placeholder;
  const triggerLabelClass = selected ? 'text-stone-900' : 'text-stone-400';

  return (
    <div ref={wrapRef} className="relative inline-block w-full">
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
        }
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-white text-left transition-colors ${sizeClass} ${
          disabled
            ? 'cursor-not-allowed border-stone-200 opacity-60'
            : open
              ? 'border-stone-300 ring-2 ring-stone-300/40'
              : 'border-stone-200 hover:border-stone-300 focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300/40'
        } ${className}`}
      >
        <span className={`truncate ${triggerLabelClass}`}>{triggerLabel}</span>
        <ChevronDown
          size={size === 'sm' ? 14 : 16}
          className={`flex-shrink-0 text-stone-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          ref={listRef}
          role="listbox"
          aria-activedescendant={
            activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined
          }
          className={`cp-select-pop absolute top-full z-50 mt-1 max-h-72 min-w-full overflow-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {searchable && (
            <div className="border-b border-stone-100 p-1.5">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Search…"
                className="w-full rounded-md border border-stone-200 bg-white px-2 py-1 text-sm focus:border-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300/40"
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-stone-500">No matches</div>
          ) : (
            filtered.map((opt, i) => {
              const isSelected = opt.value === value;
              const isActive = i === activeIndex;
              return (
                <button
                  key={`${opt.value}-${i}`}
                  id={`${optionIdPrefix}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={opt.disabled}
                  onMouseEnter={() => !opt.disabled && setActiveIndex(i)}
                  onClick={() => commit(opt)}
                  onKeyDown={onTriggerKey}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    opt.disabled
                      ? 'cursor-not-allowed opacity-50'
                      : isActive
                        ? 'bg-stone-50'
                        : 'hover:bg-stone-50'
                  } ${isSelected ? 'bg-stone-100 font-medium' : ''}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.hint && (
                    <span className="flex-shrink-0 text-xs text-stone-500">{opt.hint}</span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
