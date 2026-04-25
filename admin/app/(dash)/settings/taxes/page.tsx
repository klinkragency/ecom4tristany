'use client';

import { useEffect, useState } from 'react';
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
    <div className="max-w-4xl space-y-4">
      <p className="text-sm text-stone-500">
        VAT applied at checkout is resolved by the shipping-address country. Countries without a row
        fall back to the shop default. Prices are tax-inclusive — the number below is the effective rate used
        to back-solve tax out of the gross total.
      </p>
      {error && <div className="alert alert-error">{error}</div>}

      <div className="card card-pad">
        <h2 className="mb-3 text-sm font-semibold">Add or replace a country</h2>
        <div className="grid grid-cols-[100px_120px_1fr_auto] gap-2">
          <input
            value={draft.country}
            onChange={(e) => setDraft({ ...draft, country: e.target.value.toUpperCase() })}
            placeholder="ISO-2"
            maxLength={2}
            className="input uppercase font-mono"
          />
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            value={draft.percent}
            onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
            placeholder="20"
            className="input"
          />
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Country name (optional)"
            className="input"
          />
          <button onClick={addNew} className="btn btn-primary">Save</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="empty">No rates. Add one above, or re-apply the migration to seed the EU defaults.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th className="w-16">Country</th>
              <th>Name</th>
              <th className="w-24 text-right">Rate</th>
              <th className="w-32"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td className="font-mono font-medium">{t.country}</td>
                <td>
                  {editing?.country === t.country ? (
                    <input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      className="input"
                    />
                  ) : (
                    t.name || <span className="text-stone-400">—</span>
                  )}
                </td>
                <td className="text-right tabular-nums">
                  {editing?.country === t.country ? (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={editing.percent}
                      onChange={(e) => setEditing({ ...editing, percent: Number(e.target.value) })}
                      className="input w-24 text-right"
                    />
                  ) : (
                    `${t.percent}%`
                  )}
                </td>
                <td className="text-right">
                  {editing?.country === t.country ? (
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={async () => {
                          await save({ country: editing.country, percent: editing.percent, name: editing.name });
                          setEditing(null);
                        }}
                        className="btn btn-primary btn-sm"
                      >
                        Save
                      </button>
                      <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setEditing(t)} className="btn btn-ghost btn-sm">Edit</button>
                      <button onClick={() => del(t.country)} className="btn btn-danger btn-sm">Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
