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

  if (!menu) return <section><p className="text-stone-500">Loading…</p></section>;

  function setItems(items: Item[]) {
    if (!menu) return;
    setMenu({ ...menu, items });
  }
  function addItem(parent?: Item) {
    if (!menu) return;
    const next: Item = { label: 'New item', linkType: 'url', target: '', openInNewTab: false, children: [] };
    if (parent) {
      parent.children = [...(parent.children ?? []), next];
      setItems([...menu.items]);
    } else {
      setItems([...menu.items, next]);
    }
  }
  function removeAt(path: number[]) {
    if (!menu) return;
    const items = structuredClone(menu.items);
    let arr = items;
    for (let i = 0; i < path.length - 1; i++) {
      arr = arr[path[i]!]!.children!;
    }
    arr.splice(path[path.length - 1]!, 1);
    setItems(items);
  }
  function moveAt(path: number[], delta: -1 | 1) {
    if (!menu) return;
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
    if (!menu) return;
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
        <Link href="/content/menus" className="text-sm text-stone-500 hover:underline">← Menus</Link>
        <h1 className="h-page flex-1">{menu.name}</h1>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm rounded bg-stone-900 text-white disabled:opacity-50">
          {saving ? 'Saving…' : 'Save menu'}
        </button>
      </div>
      {error && <div className="mb-3 alert alert-error">{error}</div>}
      {saved && <div className="mb-3 alert alert-success">Saved.</div>}

      <div className="card card-pad mb-4">
        <label className="block text-sm">
          <span className="label">Menu name</span>
          <input value={menu.name} onChange={(e) => setMenu({ ...menu, name: e.target.value })}
            className="input" />
          <div className="text-xs text-stone-500 mt-1 font-mono">handle: {menu.handle}</div>
        </label>
      </div>

      <div className="card card-pad space-y-2">
        {menu.items.length === 0 ? (
          <p className="text-sm text-stone-500">No items. Add one to get started.</p>
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
        <button onClick={() => addItem()} className="btn btn-secondary btn-sm mt-2">
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
    <li className={`border border-stone-200 rounded ${isNested ? 'ml-6 bg-gray-50' : ''}`}>
      <div className="flex items-center gap-2 p-2">
        <div className="flex flex-col">
          <button onClick={() => onMove(path, -1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▲</button>
          <button onClick={() => onMove(path, 1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▼</button>
        </div>
        <input value={item.label}
          onChange={(e) => onPatch(path, { label: e.target.value })}
          placeholder="Label"
          className="input text-sm flex-1" />
        <select value={item.linkType} onChange={(e) => onPatch(path, { linkType: e.target.value as LinkType })}
          className="select w-auto text-xs">
          {LINK_TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
        </select>
        {item.linkType !== 'menu_header' && item.linkType !== 'blog' && (
          <input value={item.target} onChange={(e) => onPatch(path, { target: e.target.value })}
            placeholder={linkHelp}
            className="input text-xs w-48" />
        )}
        <label className="flex items-center gap-1 text-xs" title="Open in new tab">
          <input type="checkbox" checked={item.openInNewTab}
            onChange={(e) => onPatch(path, { openInNewTab: e.target.checked })} />
          ↗
        </label>
        {!isNested && (
          <button onClick={() => onAddChild(item)} className="btn btn-secondary btn-sm text-xs">
            + sub
          </button>
        )}
        <button onClick={() => onRemove(path)} className="btn btn-ghost btn-sm text-red-700">✕</button>
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
