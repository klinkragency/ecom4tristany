'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui';

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
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          Active currencies appear in the storefront switcher. Prices are converted at display time
          using the exchange rate against the base currency.
        </p>
        <button onClick={() => setAddOpen(true)} className="btn btn-primary shrink-0">+ Add currency</button>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No currencies. Add one above.</div>
      ) : (
        <div className="card divide-y divide-stone-200/60">
          {items.map((c) => (
            <CurrencyRow key={c.code} value={c} onSave={save} onDelete={setPendingDelete} />
          ))}
        </div>
      )}

      {addOpen && (
        <AddModal
          onClose={() => setAddOpen(false)}
          onSave={async (d) => { await save(d); setAddOpen(false); }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete currency ${pendingDelete}?` : ''}
        description="Past orders that referenced this currency keep their snapshot. New orders will fall back to the shop default."
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await api(`/api/admin/currencies/${pendingDelete}`, { method: 'DELETE' });
          setPendingDelete(null);
          await load();
        }}
      />
    </div>
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
    <div className="flex items-center gap-3 px-5 py-3 text-sm">
      <span className="w-12 font-mono font-medium">{value.code}</span>
      <span className="w-10 text-center text-stone-600">{value.symbol}</span>
      {editing ? (
        <>
          <input
            type="number"
            step="0.00000001"
            min="0"
            value={d.exchangeRate}
            disabled={d.isBase}
            onChange={(e) => setD({ ...d, exchangeRate: Number(e.target.value) })}
            className="input w-32 text-right"
          />
          <label className="flex items-center gap-1.5 text-xs text-stone-700">
            <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
            active
          </label>
          <label className="flex items-center gap-1.5 text-xs text-stone-700">
            <input
              type="checkbox"
              checked={d.isBase}
              onChange={(e) =>
                setD({ ...d, isBase: e.target.checked, exchangeRate: e.target.checked ? 1 : d.exchangeRate })
              }
            />
            base
          </label>
          <div className="ml-auto flex gap-2">
            <button onClick={submit} disabled={busy} className="btn btn-primary btn-sm">Save</button>
            <button onClick={() => { setEditing(false); setD(value); }} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
        </>
      ) : (
        <>
          <span className="w-32 text-right tabular-nums">{value.exchangeRate}</span>
          <span className="flex items-center gap-1">
            {value.isBase && <span className="badge badge-info no-dot">base</span>}
            {!value.active && <span className="badge badge-neutral no-dot">inactive</span>}
          </span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm">Edit</button>
            {!value.isBase && (
              <button onClick={() => onDelete(value.code)} className="btn btn-danger btn-sm">Delete</button>
            )}
          </div>
        </>
      )}
    </div>
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

  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold">Add currency</h2>
        {error && <div className="alert alert-error text-xs">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Code (ISO 4217)</span>
            <input
              className="input uppercase font-mono"
              maxLength={3}
              value={d.code}
              onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
              placeholder="JPY"
            />
          </label>
          <label className="block">
            <span className="label">Symbol</span>
            <input
              className="input"
              value={d.symbol}
              onChange={(e) => setD({ ...d, symbol: e.target.value })}
              placeholder="¥"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Symbol position</span>
            <select
              value={d.symbolPosition}
              onChange={(e) => setD({ ...d, symbolPosition: e.target.value as 'before' | 'after' })}
              className="select"
            >
              <option value="before">Before (e.g. $100)</option>
              <option value="after">After (e.g. 100 €)</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Decimal places</span>
            <input
              type="number"
              min={0}
              max={4}
              className="input"
              value={d.decimalPlaces}
              onChange={(e) => setD({ ...d, decimalPlaces: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="block">
          <span className="label">Exchange rate (per 1 base unit)</span>
          <input
            type="number"
            step="0.00000001"
            min="0"
            className="input"
            value={d.exchangeRate}
            onChange={(e) => setD({ ...d, exchangeRate: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
          Active (visible on storefront)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={busy || d.code.length !== 3} className="btn btn-primary">
            {busy ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
