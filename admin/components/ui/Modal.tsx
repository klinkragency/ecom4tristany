'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Selectors for everything Tab can usually focus inside the modal.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// A reusable modal:
//   - role="dialog" + aria-modal so screen readers announce it correctly
//   - ESC closes (callable from outside if you don't want it, just override onClose)
//   - clicking the backdrop closes; clicking the panel does not
//   - body scroll is locked while open
//   - focus is trapped inside the panel; on close, returns to whatever
//     was focused before opening
//   - first focusable element inside is auto-focused on open
//
// Pass `dismissible={false}` to remove the close button + backdrop click for
// flows that must complete (rare — most modals should let users escape).
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'md',
  dismissible = true,
  footer,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  dismissible?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Lock body scroll, capture focus, restore on close.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Defer focus until after paint so the panel exists.
    const id = requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    });

    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open]);

  // ESC + focus-trap (Tab / Shift+Tab cycle inside panel)
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && dismissible) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => !el.hasAttribute('inert'));
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  if (!open) return null;

  const widthClass =
    size === 'sm' ? 'max-w-sm'
    : size === 'lg' ? 'max-w-lg'
    : size === 'xl' ? 'max-w-xl'
    : 'max-w-md';

  return (
    <div
      className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={dismissible ? onClose : undefined}
      aria-hidden={!open}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        className={`cp-panel w-full ${widthClass} overflow-hidden rounded-2xl bg-white text-sm shadow-xl ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || dismissible) && (
          <header className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            {title ? (
              <h2 id="modal-title" className="text-base font-semibold">{title}</h2>
            ) : <span />}
            {dismissible && (
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </header>
        )}
        <div className="space-y-3 p-5">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
