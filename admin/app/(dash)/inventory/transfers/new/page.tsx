'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Location, ProductListPage, Transfer } from '@/lib/types';

// Minimal variant type for the picker (we reuse admin product detail endpoint).
type ProductDetail = {
  id: string;
  title: string;
  variants: { id: string; sku: string; optionValues: Record<string, string> }[];
  options: { id: string; name: string; values: { id: string; value: string }[] }[];
};

export default function NewTransferPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<{ variantId: string; label: string; quantity: number }[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<Location[]>('/api/admin/locations').then((ls) => {
      const active = ls.filter((l) => l.isActive);
      setLocations(active);
      if (active[0]) setFromId(active[0].id);
      if (active[1]) setToId(active[1].id);
    }).catch((err) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, []);

  async function submit() {
    setError(null);
    if (!fromId || !toId) { setError('Pick source and destination'); return; }
    if (fromId === toId) { setError('Source and destination must differ'); return; }
    if (items.length === 0) { setError('Add at least one item'); return; }
    setSaving(true);
    try {
      const t = await api<Transfer>('/api/admin/transfers', {
        method: 'POST',
        body: JSON.stringify({
          fromLocationId: fromId,
          toLocationId: toId,
          note,
          items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
        }),
      });
      router.push(`/inventory/transfers/${t.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/inventory/transfers" className="text-sm text-[color:var(--color-text-muted)] hover:underline">
          ← Transfers
        </Link>
        <h1 className="text-2xl font-semibold">New transfer</h1>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
      )}

      <div className="space-y-4">
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <div className="font-medium mb-1">Source</div>
            <select
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white"
            >
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            <div className="font-medium mb-1">Destination</div>
            <select
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white"
            >
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="block text-sm col-span-2">
            <div className="font-medium mb-1">Note (optional)</div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </label>
        </div>

        <div className="rounded border border-[color:var(--color-border)] bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Items ({items.length})</h2>
            <button
              onClick={() => setPickerOpen(true)}
              className="px-3 py-1.5 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50"
            >
              Add variant…
            </button>
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No items yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)]">
              {items.map((it, i) => (
                <li key={it.variantId + i} className="flex items-center gap-3 py-2 text-sm">
                  <span className="flex-1">{it.label}</span>
                  <input
                    type="number"
                    min={1}
                    value={it.quantity}
                    onChange={(e) => {
                      const q = Math.max(1, parseInt(e.target.value || '1', 10));
                      setItems((arr) => arr.map((x, idx) => (idx === i ? { ...x, quantity: q } : x)));
                    }}
                    className="w-20 px-2 py-1 rounded border border-[color:var(--color-border)] text-right"
                  />
                  <button
                    onClick={() => setItems((arr) => arr.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-700 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Link
            href="/inventory/transfers"
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)]"
          >Cancel</Link>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </div>

      {pickerOpen && (
        <VariantPicker
          onClose={() => setPickerOpen(false)}
          onPick={(variantId, label) => {
            setItems((arr) => [...arr, { variantId, label, quantity: 1 }]);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}

function VariantPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (variantId: string, label: string) => void;
}) {
  const [list, setList] = useState<ProductListPage | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<ProductDetail | null>(null);

  async function load(q = '') {
    const data = await api<ProductListPage>(`/api/admin/products?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`);
    setList(data);
  }
  useEffect(() => { load(); }, []);

  async function expand(productId: string) {
    setExpanded(productId);
    setExpandedDetail(null);
    const d = await api<ProductDetail>(`/api/admin/products/${productId}`);
    setExpandedDetail(d);
  }

  function variantLabel(d: ProductDetail, v: ProductDetail['variants'][number]): string {
    if (d.options.length === 0) return `${d.title} — Default`;
    const parts = d.options.map((o) => {
      const valId = v.optionValues[o.id];
      const val = o.values.find((x) => x.id === valId);
      return val?.value ?? '?';
    });
    return `${d.title} — ${parts.join(' / ')}`;
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl flex flex-col max-h-[80vh]">
        <div className="p-4 border-b border-[color:var(--color-border)] flex items-center justify-between">
          <h2 className="text-sm font-semibold">Add variant to transfer</h2>
          <button onClick={onClose} className="text-sm">✕</button>
        </div>
        <div className="p-4 border-b border-[color:var(--color-border)]">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); load(e.target.value); }}
            placeholder="Search products…"
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
          />
        </div>
        <div className="overflow-y-auto flex-1 text-sm">
          {!list && <div className="p-4 text-[color:var(--color-text-muted)]">Loading…</div>}
          {list?.items.map((p) => (
            <div key={p.id} className="border-b border-[color:var(--color-border)]">
              <button
                onClick={() => (expanded === p.id ? setExpanded(null) : expand(p.id))}
                className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between"
              >
                <span>{p.title}</span>
                <span className="text-xs text-[color:var(--color-text-muted)]">{p.variantCount} variant{p.variantCount === 1 ? '' : 's'}</span>
              </button>
              {expanded === p.id && expandedDetail && (
                <ul>
                  {expandedDetail.variants.map((v) => (
                    <li key={v.id}>
                      <button
                        onClick={() => onPick(v.id, variantLabel(expandedDetail, v))}
                        className="w-full text-left px-8 py-1.5 hover:bg-gray-100 text-[color:var(--color-text-muted)]"
                      >
                        {variantLabel(expandedDetail, v)} {v.sku && <span className="text-xs">· {v.sku}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
