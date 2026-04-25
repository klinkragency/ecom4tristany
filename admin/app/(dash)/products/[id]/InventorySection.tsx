'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { InventoryMatrix } from '@/lib/types';

export default function InventorySection({ productId }: { productId: string }) {
  const [matrix, setMatrix] = useState<InventoryMatrix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, number>>({}); // `${vid}|${lid}` -> onHand
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      setMatrix(await api<InventoryMatrix>(`/api/admin/products/${productId}/inventory`));
      setEdits({});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, [productId]);

  function setCell(vid: string, lid: string, val: number) {
    setEdits((e) => ({ ...e, [`${vid}|${lid}`]: val }));
    setSaved(false);
  }

  async function save() {
    if (!matrix) return;
    const levels: { variantId: string; locationId: string; onHand: number }[] = [];
    for (const [key, onHand] of Object.entries(edits)) {
      const [vid, lid] = key.split('|');
      levels.push({ variantId: vid!, locationId: lid!, onHand });
    }
    if (levels.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await api('/api/admin/inventory/set', {
        method: 'POST',
        body: JSON.stringify({ levels, reason: 'correction', note: '' }),
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!matrix) {
    return (
      <div className="rounded border border-stone-200 bg-white p-4 text-sm text-stone-500">
        Loading inventory…
      </div>
    );
  }

  const dirty = Object.keys(edits).length > 0;
  const readValue = (vid: string, lid: string, fallback: number) => {
    const k = `${vid}|${lid}`;
    return edits[k] ?? fallback;
  };

  return (
    <div className="card card-pad">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Inventory ({matrix.variants.length} variants × {matrix.locations.length} locations)</h2>
        <div className="flex items-center gap-2 text-xs">
          <Link href="/settings/locations" className="text-stone-500 hover:underline">
            Manage locations →
          </Link>
          {saved && !dirty && <span className="text-green-700">Saved</span>}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="btn btn-primary btn-sm"
          >
            {saving ? 'Saving…' : dirty ? 'Save inventory' : 'No changes'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error text-xs mb-3">
          {error}
        </div>
      )}

      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-2 py-1.5 font-medium sticky left-0 bg-gray-50 z-10">Variant</th>
              {matrix.locations.map((l) => (
                <th key={l.id} className="px-2 py-1.5 font-medium min-w-[110px]" title={l.active ? 'active' : 'inactive'}>
                  {l.name}
                </th>
              ))}
              <th className="px-2 py-1.5 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.variants.map((v) => (
              <tr key={v.id} className="border-t border-stone-200">
                <td className="px-2 py-1.5 sticky left-0 bg-white z-10">
                  <div className="font-medium">{v.label}</div>
                  {v.sku && <div className="text-xs text-stone-500">{v.sku}</div>}
                </td>
                {matrix.locations.map((l) => {
                  const cell = v.levels[l.id] ?? { onHand: 0, committed: 0, incoming: 0 };
                  const val = readValue(v.id, l.id, cell.onHand);
                  return (
                    <td key={l.id} className="px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        value={val}
                        onChange={(e) => setCell(v.id, l.id, Math.max(0, parseInt(e.target.value || '0', 10)))}
                        className="input text-sm text-right"
                      />
                      {cell.incoming > 0 && (
                        <div className="text-[10px] text-amber-700 text-right">+{cell.incoming} incoming</div>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right font-medium">{v.totalOnHand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
