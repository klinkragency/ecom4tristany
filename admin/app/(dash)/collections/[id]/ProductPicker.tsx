'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type ProductListPage } from '@/lib/types';

export default function ProductPicker({
  collectionId,
  existingIds,
  onClose,
  onAttached,
}: {
  collectionId: string;
  existingIds: Set<string>;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [page, setPage] = useState<ProductListPage | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
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

  async function attach() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await api(`/api/admin/collections/${collectionId}/products`, {
        method: 'POST',
        body: JSON.stringify({ productIds: [...selected] }),
      });
      onAttached();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Attach failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
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
            className="w-full px-3 py-2 rounded border border-stone-200"
          />
        </div>
        <div className="overflow-y-auto flex-1">
          {error && (
            <div className="m-3 alert alert-error">
              {error}
            </div>
          )}
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
                    already ? 'opacity-50' : 'cursor-pointer hover:bg-gray-50'
                  }`}
                  onClick={() => !already && toggle(p.id)}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(p.id) || already}
                    disabled={already}
                    onChange={() => {}}
                  />
                  <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0">
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
                  <div className="text-xs text-stone-500">
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
          <div className="text-sm text-stone-500">
            {selected.size} selected
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm rounded border border-stone-200"
            >
              Cancel
            </button>
            <button
              onClick={attach}
              disabled={saving || selected.size === 0}
              className="px-3 py-2 text-sm rounded bg-stone-900 text-white disabled:opacity-50"
            >
              {saving ? 'Adding…' : `Add ${selected.size || ''}`.trim()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
