'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type TaxRate = {
  id: string;
  country: string;
  percent: number;
  name: string;
  updatedAt: string;
};

export default function TaxesPage() {
  const [items, setItems] = useState<TaxRate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ country: string; percent: string; name: string }>({
    country: '', percent: '', name: '',
  });
  const [editing, setEditing] = useState<TaxRate | null>(null);

  async function load() {
    try {
      const data = await api<{ items: TaxRate[] }>('/api/admin/tax-rates');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function save(input: { country: string; percent: number; name: string }) {
    try {
      await api('/api/admin/tax-rates', { method: 'PUT', body: JSON.stringify(input) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  async function addNew() {
    const country = draft.country.trim().toUpperCase();
    const percent = parseFloat(draft.percent);
    if (country.length !== 2 || Number.isNaN(percent)) {
      setError('Invalid country code or percent');
      return;
    }
    await save({ country, percent, name: draft.name });
    setDraft({ country: '', percent: '', name: '' });
  }

  async function del(country: string) {
    if (!confirm(`Delete VAT rate for ${country}?`)) return;
    try {
      await api(`/api/admin/tax-rates/${country}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold">Tax rates</h1>
      </div>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        VAT applied at checkout is resolved by the shipping-address country. Countries without a row
        fall back to the shop default (<span className="font-mono">SHOP_VAT_PERCENT</span> in env / General settings).
        Prices are tax-inclusive — the number below is the effective rate used to back-solve tax out of the gross total.
      </p>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {/* Add new */}
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">Add or replace a country</h2>
        <div className="grid grid-cols-[100px_120px_1fr_auto] gap-2 text-sm">
          <input
            value={draft.country}
            onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })}
            placeholder="ISO-2"
            maxLength={2}
            className="px-3 py-2 rounded border border-[color:var(--color-border)] uppercase font-mono"
          />
          <input
            type="number" step="0.01" min="0" max="100"
            value={draft.percent}
            onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
            placeholder="20"
            className="px-3 py-2 rounded border border-[color:var(--color-border)]"
          />
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Country name (optional)"
            className="px-3 py-2 rounded border border-[color:var(--color-border)]"
          />
          <button
            onClick={addNew}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white"
          >
            Save
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No rates. Add one above, or re-apply the migration to seed the EU defaults.
        </div>
      ) : (
        <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
          <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium w-16">Country</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium w-24 text-right">Rate</th>
              <th className="px-3 py-2 font-medium w-16"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className="border-b border-[color:var(--color-border)]">
                <td className="px-3 py-2 font-mono font-medium">{t.country}</td>
                <td className="px-3 py-2">
                  {editing?.country === t.country ? (
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="w-full px-2 py-1 rounded border border-[color:var(--color-border)]"
                    />
                  ) : t.name || <span className="text-[color:var(--color-text-muted)]">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {editing?.country === t.country ? (
                    <input
                      type="number" step="0.01" min="0" max="100"
                      value={editing.percent}
                      onChange={(e) => setEditing({ ...editing, percent: Number(e.target.value) })}
                      className="w-20 px-2 py-1 rounded border border-[color:var(--color-border)] text-right"
                    />
                  ) : `${t.percent}%`}
                </td>
                <td className="px-3 py-2 text-right">
                  {editing?.country === t.country ? (
                    <>
                      <button
                        onClick={async () => { await save({ country: editing.country, percent: editing.percent, name: editing.name }); setEditing(null); }}
                        className="text-xs hover:underline mr-2"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditing(null)} className="text-xs text-[color:var(--color-text-muted)] hover:underline">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setEditing(t)} className="text-xs hover:underline mr-2">Edit</button>
                      <button onClick={() => del(t.country)} className="text-xs text-red-700 hover:underline">Delete</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
