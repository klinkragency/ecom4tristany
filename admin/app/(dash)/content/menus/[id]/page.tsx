'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type LinkType =
  | 'url' | 'page' | 'collection' | 'product'
  | 'blog' | 'blog_post' | 'menu_header';

type Item = {
  id?: string;
  label: string;
  linkType: LinkType;
  target: string;
  openInNewTab: boolean;
  children?: Item[];
};

type Menu = {
  id: string;
  handle: string;
  name: string;
  items: Item[];
};

const LINK_TYPES: { v: LinkType; l: string; help: string }[] = [
  { v: 'url',         l: 'External URL',     help: 'https://example.com' },
  { v: 'page',        l: 'CMS page',         help: 'page slug, e.g. about' },
  { v: 'collection',  l: 'Collection',       help: 'collection handle' },
  { v: 'product',     l: 'Product',          help: 'product handle' },
  { v: 'blog',        l: 'Blog index',       help: '(target ignored)' },
  { v: 'blog_post',   l: 'Blog post',        help: 'post slug' },
  { v: 'menu_header', l: 'Header (no link)', help: 'section header' },
];

export default function MenuEditor() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [menu, setMenu] = useState<Menu | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      setMenu(await api<Menu>(`/api/admin/content/menus/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [id]);

  async function save() {
    if (!menu) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Server expects { name, items: [{ label, linkType, target, openInNewTab, children }] }
      const clean = (arr: Item[]): Item[] => arr.map((it) => ({
        label: it.label,
        linkType: it.linkType,
        target: it.target,
        openInNewTab: it.openInNewTab,
        children: it.children && it.children.length > 0 ? clean(it.children) : undefined,
      })) as Item[];
      await api(`/api/admin/content/menus/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: menu.name, items: clean(menu.items) }),
      });
      setSaved(true);
      await load();
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!menu) return <section><p className="text-[color:var(--color-text-muted)]">Loading…</p></section>;

  function setItems(items: Item[]) {
    if (!menu) return;
    setMenu({ ...menu, items });
  }
  function addItem(parent?: Item) {
    const next: Item = { label: 'New item', linkType: 'url', target: '', openInNewTab: false, children: [] };
    if (parent) {
      parent.children = [...(parent.children ?? []), next];
      setItems([...menu.items]);
    } else {
      setItems([...menu.items, next]);
    }
  }
  function removeAt(path: number[]) {
    const items = structuredClone(menu.items);
    let arr = items;
    for (let i = 0; i < path.length - 1; i++) {
      arr = arr[path[i]!]!.children!;
    }
    arr.splice(path[path.length - 1]!, 1);
    setItems(items);
  }
  function moveAt(path: number[], delta: -1 | 1) {
    const items = structuredClone(menu.items);
    let arr = items;
    for (let i = 0; i < path.length - 1; i++) {
      arr = arr[path[i]!]!.children!;
    }
    const idx = path[path.length - 1]!;
    const j = idx + delta;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j]!, arr[idx]!];
    setItems(items);
  }
  function patchAt(path: number[], patch: Partial<Item>) {
    const items = structuredClone(menu.items);
    let arr = items;
    for (let i = 0; i < path.length - 1; i++) {
      arr = arr[path[i]!]!.children!;
    }
    arr[path[path.length - 1]!] = { ...arr[path[path.length - 1]!]!, ...patch };
    setItems(items);
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content/menus" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Menus</Link>
        <h1 className="text-2xl font-semibold flex-1">{menu.name}</h1>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save menu'}
        </button>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {saved && <div className="mb-3 rounded border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">Saved.</div>}

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
        <label className="block text-sm">
          <div className="font-medium mb-1">Menu name</div>
          <input value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.target.value })}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1 font-mono">handle: {menu.handle}</div>
        </label>
      </div>

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-2">
        {menu.items.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">No items. Add one to get started.</p>
        ) : (
          <ul className="space-y-2">
            {menu.items.map((it, i) => (
              <MenuItemRow key={i}
                item={it}
                path={[i]}
                onPatch={patchAt}
                onRemove={removeAt}
                onMove={moveAt}
                onAddChild={addItem}
              />
            ))}
          </ul>
        )}
        <button onClick={() => addItem()} className="mt-2 text-xs px-3 py-1.5 rounded border border-[color:var(--color-border)] hover:bg-gray-50">
          + Add item
        </button>
      </div>
    </section>
  );
}

function MenuItemRow({
  item, path, onPatch, onRemove, onMove, onAddChild,
}: {
  item: Item;
  path: number[];
  onPatch: (path: number[], patch: Partial<Item>) => void;
  onRemove: (path: number[]) => void;
  onMove: (path: number[], delta: -1 | 1) => void;
  onAddChild: (parent: Item) => void;
}) {
  const linkHelp = LINK_TYPES.find((l) => l.v === item.linkType)?.help ?? '';
  const isNested = path.length > 1;
  return (
    <li className={`border border-[color:var(--color-border)] rounded ${isNested ? 'ml-6 bg-gray-50' : ''}`}>
      <div className="flex items-center gap-2 p-2">
        <div className="flex flex-col">
          <button onClick={() => onMove(path, -1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▲</button>
          <button onClick={() => onMove(path, 1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▼</button>
        </div>
        <input value={item.label}
          onChange={(e) => onPatch(path, { label: e.target.value })}
          placeholder="Label"
          className="flex-1 px-2 py-1 rounded border border-[color:var(--color-border)] text-sm" />
        <select value={item.linkType} onChange={(e) => onPatch(path, { linkType: e.target.value as LinkType })}
          className="px-2 py-1 rounded border border-[color:var(--color-border)] text-xs bg-white">
          {LINK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        {item.linkType !== 'menu_header' && item.linkType !== 'blog' && (
          <input value={item.target} onChange={(e) => onPatch(path, { target: e.target.value })}
            placeholder={linkHelp}
            className="w-48 px-2 py-1 rounded border border-[color:var(--color-border)] text-xs" />
        )}
        <label className="flex items-center gap-1 text-xs" title="Open in new tab">
          <input type="checkbox" checked={item.openInNewTab}
            onChange={(e) => onPatch(path, { openInNewTab: e.target.checked })} />
          ↗
        </label>
        {!isNested && (
          <button onClick={() => onAddChild(item)} className="text-xs px-2 py-0.5 rounded border border-[color:var(--color-border)] hover:bg-gray-50">
            + sub
          </button>
        )}
        <button onClick={() => onRemove(path)} className="text-xs text-red-700 hover:underline">✕</button>
      </div>
      {item.children && item.children.length > 0 && (
        <ul className="pb-2 space-y-1">
          {item.children.map((c, ci) => (
            <MenuItemRow key={ci}
              item={c}
              path={[...path, ci]}
              onPatch={onPatch}
              onRemove={onRemove}
              onMove={onMove}
              onAddChild={onAddChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
