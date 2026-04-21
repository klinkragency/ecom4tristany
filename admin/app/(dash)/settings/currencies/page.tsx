'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Currency = {
  code: string;
  symbol: string;
  symbolPosition: 'before' | 'after';
  decimalPlaces: number;
  exchangeRate: number;
  active: boolean;
  isBase: boolean;
  position: number;
  updatedAt: string;
};

type Draft = Omit<Currency, 'updatedAt'>;

const EMPTY_DRAFT: Draft = {
  code: '',
  symbol: '',
  symbolPosition: 'after',
  decimalPlaces: 2,
  exchangeRate: 1,
  active: true,
  isBase: false,
  position: 0,
};

export default function CurrenciesPage() {
  const [items, setItems] = useState<Currency[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function load() {
    try {
      const data = await api<{ items: Currency[] }>('/api/admin/currencies');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function save(d: Draft) {
    try {
      await api('/api/admin/currencies', { method: 'PUT', body: JSON.stringify(d) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      throw err;
    }
  }

  async function del(code: string) {
    if (!confirm(`Delete currency ${code}?`)) return;
    try {
      await api(`/api/admin/currencies/${code}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold flex-1">Currencies</h1>
        <button onClick={() => setAddOpen(true)}
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">
          + Add currency
        </button>
      </div>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Active currencies appear in the storefront switcher. Prices are converted at display time
        using the exchange rate against the base currency. Orders are still charged in the base
        currency (the checkout displays a note when the buyer has picked a different one).
      </p>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No currencies. Add one above.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
          {items.map((c) => (
            <CurrencyRow key={c.code} value={c} onSave={save} onDelete={del} />
          ))}
        </ul>
      )}

      {addOpen && (
        <AddModal
          onClose={() => setAddOpen(false)}
          onSave={async (d) => { await save(d); setAddOpen(false); }}
        />
      )}
    </section>
  );
}

function CurrencyRow({
  value, onSave, onDelete,
}: {
  value: Currency;
  onSave: (d: Draft) => Promise<void>;
  onDelete: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [d, setD] = useState<Draft>(value);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try { await onSave(d); setEditing(false); } finally { setBusy(false); }
  }

  return (
    <li className="px-3 py-2 flex items-center gap-3 text-sm">
      <span className="w-12 font-mono font-medium">{value.code}</span>
      <span className="w-10 text-center">{value.symbol}</span>
      {editing ? (
        <>
          <input type="number" step="0.00000001" min="0"
            value={d.exchangeRate}
            disabled={d.isBase}
            onChange={(e) => setD({ ...d, exchangeRate: Number(e.target.value) })}
            className="w-32 px-2 py-1 rounded border border-[color:var(--color-border)] text-right" />
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
            active
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={d.isBase}
              onChange={(e) => setD({ ...d, isBase: e.target.checked, exchangeRate: e.target.checked ? 1 : d.exchangeRate })} />
            base
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={submit} disabled={busy} className="text-xs hover:underline">Save</button>
            <button onClick={() => { setEditing(false); setD(value); }} className="text-xs text-[color:var(--color-text-muted)] hover:underline">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <span className="w-32 text-right">{value.exchangeRate}</span>
          <span className="flex items-center gap-1 text-xs">
            {value.isBase && <span className="rounded bg-purple-100 text-purple-800 px-1.5 py-0.5">base</span>}
            {!value.active && <span className="rounded bg-gray-100 text-gray-800 px-1.5 py-0.5">inactive</span>}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setEditing(true)} className="text-xs hover:underline">Edit</button>
            {!value.isBase && (
              <button onClick={() => onDelete(value.code)} className="text-xs text-red-700 hover:underline">Delete</button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

function AddModal({
  onClose, onSave,
}: {
  onClose: () => void;
  onSave: (d: Draft) => Promise<void>;
}) {
  const [d, setD] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try { await onSave({ ...d, code: d.code.toUpperCase() }); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Save failed'); }
    finally { setBusy(false); }
  }

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm';

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-semibold">Add currency</h2>
        {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="font-medium mb-1">Code (ISO 4217)</div>
            <input className={input + ' uppercase font-mono'} maxLength={3}
              value={d.code}
              onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
              placeholder="JPY" />
          </label>
          <label className="block">
            <div className="font-medium mb-1">Symbol</div>
            <input className={input} value={d.symbol}
              onChange={(e) => setD({ ...d, symbol: e.target.value })} placeholder="¥" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="font-medium mb-1">Symbol position</div>
            <select value={d.symbolPosition}
              onChange={(e) => setD({ ...d, symbolPosition: e.target.value as 'before' | 'after' })}
              className={input + ' bg-white'}>
              <option value="before">Before (e.g. $100)</option>
              <option value="after">After (e.g. 100 €)</option>
            </select>
          </label>
          <label className="block">
            <div className="font-medium mb-1">Decimal places</div>
            <input type="number" min={0} max={4} className={input}
              value={d.decimalPlaces}
              onChange={(e) => setD({ ...d, decimalPlaces: Number(e.target.value) })} />
          </label>
        </div>
        <label className="block">
          <div className="font-medium mb-1">Exchange rate (per 1 base unit)</div>
          <input type="number" step="0.00000001" min="0" className={input}
            value={d.exchangeRate}
            onChange={(e) => setD({ ...d, exchangeRate: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={d.active}
            onChange={(e) => setD({ ...d, active: e.target.checked })} />
          Active (visible on storefront)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={submit} disabled={busy || d.code.length !== 3}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
