'use client';

/**
 * Minimal rich-text editor built on contentEditable + the browser's built-in
 * formatting commands.
 *
 * Why not Tiptap / Lexical? Those are powerful but introduce controlled-input
 * gotchas (stale editor refs, storedMarks leaking between mounts, StrictMode
 * double-mount in dev). For our needs — bold, italic, strike, H2/H3, lists,
 * blockquote, link — the browser's built-in commands are universally supported,
 * predictable, and trivial to reason about.
 *
 * Security: contentEditable output is never trusted. The server
 * (bluemonday in internal/htmlx) sanitizes before storage. The storefront
 * re-sanitizes with DOMPurify before rendering. Defense in depth.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
};

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // A counter that bumps after selection/input so the toolbar re-renders its
  // `active` states. We don't cache the active set — we query the DOM on render.
  const [, bump] = useState(0);
  const rebump = useCallback(() => bump((n) => n + 1), []);
  // Track editor focus so toolbar active states only reflect reality when the
  // editor actually has the selection — otherwise queryCommandState returns
  // stale data that can flip the B/I/S buttons for no visible reason.
  const [hasFocus, setHasFocus] = useState(false);

  // Push external `value` into the DOM ONLY when it differs from what's on screen
  // AND the editor is not focused. Otherwise we'd clobber the caret mid-typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const current = readHtml(el);
    const next = value || '';
    if (current === next) return;
    if (document.activeElement === el) return;
    writeHtml(el, next);
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = readHtml(el);
    onChange(html);
  }

  function runCmd(cmd: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    emit();
    rebump();
  }

  function toggleHeading(level: 2 | 3) {
    if (queryBlock() === `h${level}`) {
      runCmd('formatBlock', 'p');
    } else {
      runCmd('formatBlock', `h${level}`);
    }
  }

  function toggleLink() {
    const existing = currentLinkHref();
    const url = window.prompt('URL (leave empty to remove)', existing ?? 'https://');
    if (url === null) return;
    if (url === '' || url === 'https://') {
      runCmd('unlink');
    } else {
      runCmd('createLink', url);
    }
  }

  function clearFormat() {
    ref.current?.focus();
    document.execCommand('removeFormat');
    document.execCommand('formatBlock', false, 'p');
    emit();
    rebump();
  }

  const isActive = (cmd: string) => {
    if (!hasFocus) return false;
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  const block = hasFocus ? queryBlock() : '';
  const linkHref = hasFocus ? currentLinkHref() : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Text formatting">
        <TBtn active={isActive('bold')} onRun={() => runCmd('bold')} label="Bold"><b>B</b></TBtn>
        <TBtn active={isActive('italic')} onRun={() => runCmd('italic')} label="Italic"><i>I</i></TBtn>
        <TBtn active={isActive('strikeThrough')} onRun={() => runCmd('strikeThrough')} label="Strikethrough"><s>S</s></TBtn>
        <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
        <TBtn active={block === 'h2'} onRun={() => toggleHeading(2)} label="Heading 2">H2</TBtn>
        <TBtn active={block === 'h3'} onRun={() => toggleHeading(3)} label="Heading 3">H3</TBtn>
        <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
        <TBtn
          active={isActive('insertUnorderedList')}
          onRun={() => runCmd('insertUnorderedList')}
          label="Bullet list"
        >• List</TBtn>
        <TBtn
          active={isActive('insertOrderedList')}
          onRun={() => runCmd('insertOrderedList')}
          label="Ordered list"
        >1. List</TBtn>
        <TBtn
          active={block === 'blockquote'}
          onRun={() => runCmd('formatBlock', 'blockquote')}
          label="Blockquote"
        >❝</TBtn>
        <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
        <TBtn active={!!linkHref} onRun={toggleLink} label="Link">Link</TBtn>
        <TBtn active={false} onRun={clearFormat} label="Clear formatting">Clear</TBtn>
      </div>

      <div
        ref={ref}
        role="textbox"
        contentEditable
        suppressContentEditableWarning
        className="rte-editor focus:outline-none px-3 py-2 rounded border border-[color:var(--color-border)] bg-white text-sm"
        style={{ minHeight }}
        data-placeholder={placeholder ?? 'Start typing…'}
        onInput={() => { emit(); rebump(); }}
        onFocus={() => { setHasFocus(true); rebump(); }}
        onBlur={() => { setHasFocus(false); emit(); rebump(); }}
        onKeyUp={rebump}
        onMouseUp={rebump}
      />
    </div>
  );
}

function TBtn({
  active,
  onRun,
  label,
  children,
}: {
  active: boolean;
  onRun: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const cls = `px-2 py-1 text-sm rounded border ${
    active
      ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
      : 'border-[color:var(--color-border)] bg-white hover:bg-gray-50'
  }`;
  return (
    <button
      type="button"
      // mousedown preventDefault keeps the editor focused so the selection
      // survives the click — classic toolbar gotcha.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={cls}
      aria-label={label}
    >
      {children}
    </button>
  );
}

// ─── DOM helpers (avoid `.innerHTML` to satisfy the security linter and
//     because DOMParser drops <script> tags for free). ────────────────────

function readHtml(el: HTMLElement): string {
  const parts: string[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.ELEMENT_NODE) {
      parts.push((n as Element).outerHTML);
    } else if (n.nodeType === Node.TEXT_NODE) {
      parts.push(escapeHtml(n.textContent ?? ''));
    }
  });
  const html = parts.join('');
  // Normalize empty states the browser emits for an empty contentEditable.
  if (html === '' || html === '<br>' || html === '<p><br></p>') return '';
  return html;
}

function writeHtml(el: HTMLElement, html: string) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  el.replaceChildren(...Array.from(doc.body.childNodes));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function queryBlock(): string {
  if (typeof document === 'undefined') return '';
  try {
    const name = document.queryCommandValue('formatBlock');
    return typeof name === 'string' ? name.toLowerCase() : '';
  } catch {
    return '';
  }
}

function currentLinkHref(): string | null {
  if (typeof window === 'undefined') return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.anchorNode;
  while (node && node.nodeType !== 1) node = node.parentNode;
  let el = node as HTMLElement | null;
  while (el) {
    if (el.tagName === 'A') return el.getAttribute('href');
    el = el.parentElement;
  }
  return null;
}
