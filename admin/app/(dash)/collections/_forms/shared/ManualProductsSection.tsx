// admin/app/(dash)/collections/_forms/shared/ManualProductsSection.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type ProductListPage, type ProductListItem } from '@/lib/types';
import type { CollectionPayload } from './types';

// A self-contained "Products" card for manual collections. It owns:
//   - the picker dialog (shown when the user clicks "Add products")
//   - the inline list of currently-selected products with a remove button
//
// Selected ids live in the parent payload so save() can persist them. We
// fetch product metadata for selected ids on mount/changes so the row can
// render an image + title even before the parent has refreshed its data.

type ProductMeta = Pick<ProductListItem, 'id' | 'title' | 'handle' | 'status' | 'minPriceCents' | 'maxPriceCents' | 'primaryImageUrl'>;

export function ManualProductsSection({
  values,
  onChange,
}: {
  values: Pick<CollectionPayload, 'productIds'>;
  onChange: (patch: Partial<CollectionPayload>) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [meta, setMeta] = useState<Record<string, ProductMeta>>({});

  // Load metadata for any selected id we don't yet know about. Cheap because
  // we only re-fetch when the selection actually changes.
  useEffect(() => {
    const missing = values.productIds.filter((id) => !meta[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        // Pull a fresh page; the picker uses the same endpoint.
        const data = await api<ProductListPage>(`/api/admin/products?limit=200`);
        if (cancelled) return;
        const next = { ...meta };
        for (const it of data.items) next[it.id] = it;
        setMeta(next);
      } catch {
        /* ignore — list will just lack thumbnails */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.productIds.join(',')]);

  function remove(id: string) {
    onChange({ productIds: values.productIds.filter((x) => x !== id) });
  }

  function move(id: string, dir: -1 | 1) {
    const ids = [...values.productIds];
    const idx = ids.indexOf(id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap]!, ids[idx]!];
    onChange({ productIds: ids });
  }

  return (
    <Card
      title={`Products (${values.productIds.length})`}
      action={
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="btn btn-secondary"
        >
          Add products
        </button>
      }
    >
      {values.productIds.length === 0 ? (
        <p className="text-sm text-stone-500">
          No products yet. Click <span className="font-medium">Add products</span> to pick a few.
        </p>
      ) : (
        <ul className="divide-y divide-stone-200">
          {values.productIds.map((id) => {
            const m = meta[id];
            return (
              <li key={id} className="flex items-center gap-3 py-2 text-sm">
                <div className="w-10 h-10 rounded bg-stone-100 overflow-hidden shrink-0">
                  {m?.primaryImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.primaryImageUrl} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m?.title ?? id}</div>
                  <div className="text-xs text-stone-500">
                    {m ? `${m.handle} · ${m.status}` : 'Loading…'}
                  </div>
                </div>
                {m && (
                  <div className="text-xs text-stone-500 tabular-nums">
                    {m.minPriceCents === m.maxPriceCents
                      ? formatPrice(m.minPriceCents)
                      : `${formatPrice(m.minPriceCents)} – ${formatPrice(m.maxPriceCents)}`}
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Move up"
                    onClick={() => move(id, -1)}
                    className="rounded px-1.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    onClick={() => move(id, 1)}
                    className="rounded px-1.5 py-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(id)}
                    className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {pickerOpen && (
        <ProductPickerDialog
          existingIds={new Set(values.productIds)}
          onClose={() => setPickerOpen(false)}
          onSelect={(ids) => {
            // Append any newly-selected ids; existing ones are filtered.
            const merged = [...values.productIds];
            for (const id of ids) {
              if (!merged.includes(id)) merged.push(id);
            }
            onChange({ productIds: merged });
            setPickerOpen(false);
          }}
        />
      )}
    </Card>
  );
}

// Modal-style product picker that hands its selection to the caller via
// onSelect. Unlike `[id]/ProductPicker.tsx`, it does NOT call the attach
// API itself — it's purely a selection UI.
function ProductPickerDialog({
  existingIds,
  onClose,
  onSelect,
}: {
  existingIds: Set<string>;
  onClose: () => void;
  onSelect: (ids: string[]) => void;
}) {
  const [page, setPage] = useState<ProductListPage | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function load(q = '') {
    try {
      const data = await api<ProductListPage>(
        `/api/admin/products?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setPage(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add products</h2>
          <button onClick={onClose} className="text-sm text-stone-500 hover:text-black">
            ✕
          </button>
        </div>
        <div className="p-4 border-b border-stone-200">
          <input
            type="search"
            placeholder="Search products…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              load(e.target.value);
            }}
            className="input"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {error && <div className="m-3 alert alert-error">{error}</div>}
          {page && page.items.length === 0 && (
            <div className="p-4 text-sm text-stone-500">No products found.</div>
          )}
          <ul className="divide-y divide-stone-200">
            {page?.items.map((p) => {
              const already = existingIds.has(p.id);
              return (
                <li
                  key={p.id}
                  className={`flex items-center gap-3 p-3 text-sm ${
                    already ? 'opacity-50' : 'cursor-pointer hover:bg-stone-50'
                  }`}
                  onClick={() => !already && toggle(p.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id) || already}
                    disabled={already}
                    onChange={() => {}}
                  />
                  <div className="w-10 h-10 rounded bg-stone-100 overflow-hidden shrink-0">
                    {p.primaryImageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.primaryImageUrl} alt="" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{p.title}</div>
                    <div className="text-xs text-stone-500">
                      {p.handle} · {p.status} {already && '· already in'}
                    </div>
                  </div>
                  <div className="text-xs text-stone-500 tabular-nums">
                    {p.minPriceCents === p.maxPriceCents
                      ? formatPrice(p.minPriceCents)
                      : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="p-4 border-t border-stone-200 flex items-center justify-between">
          <div className="text-sm text-stone-500">{selected.size} selected</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              onClick={() => onSelect([...selected])}
              disabled={selected.size === 0}
              className="btn btn-primary"
            >
              Add {selected.size || ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
