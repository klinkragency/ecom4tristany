'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Rate = {
  id: string;
  zoneId: string;
  name: string;
  kind: 'flat' | 'weight';
  flatCents: number;
  perKgCents: number;
  minCents: number;
  freeOverCents: number | null;
  active: boolean;
  position: number;
};

type Zone = {
  id: string;
  name: string;
  position: number;
  countries: string[];
  rates: Rate[];
};

function fmtEur(cents: number): string {
  return (cents / 100).toFixed(2) + ' €';
}

export default function ShippingSettingsPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingZone, setEditingZone] = useState<Partial<Zone> | null>(null);
  const [editingRate, setEditingRate] = useState<{ zoneId: string; rate: Partial<Rate> } | null>(null);

  async function load() {
    try {
      const data = await api<{ items: Zone[] }>('/api/admin/shipping/zones');
      setZones(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function saveZone(z: Partial<Zone>) {
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: z.name ?? '',
        position: z.position ?? 0,
        countries: z.countries ?? [],
      });
      if (z.id) {
        await api(`/api/admin/shipping/zones/${z.id}`, { method: 'PUT', body });
      } else {
        await api(`/api/admin/shipping/zones`, { method: 'POST', body });
      }
      setEditingZone(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteZone(id: string) {
    if (!confirm('Delete this zone and all its rates?')) return;
    try {
      await api(`/api/admin/shipping/zones/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function saveRate() {
    if (!editingRate) return;
    const r = editingRate.rate;
    setBusy(true);
    setError(null);
    try {
      const body = JSON.stringify({
        name: r.name ?? '',
        kind: r.kind ?? 'flat',
        flatCents: r.flatCents ?? 0,
        perKgCents: r.perKgCents ?? 0,
        minCents: r.minCents ?? 0,
        freeOverCents: r.freeOverCents ?? null,
        active: r.active ?? true,
        position: r.position ?? 0,
      });
      if (r.id) {
        await api(`/api/admin/shipping/rates/${r.id}`, { method: 'PUT', body });
      } else {
        await api(`/api/admin/shipping/zones/${editingRate.zoneId}/rates`, { method: 'POST', body });
      }
      setEditingRate(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRate(id: string) {
    if (!confirm('Delete this rate?')) return;
    try {
      await api(`/api/admin/shipping/rates/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold flex-1">Shipping</h1>
        <button
          onClick={() => setEditingZone({ name: '', countries: [], position: 0 })}
          className="px-3 py-1.5 text-sm rounded bg-[color:var(--color-accent)] text-white"
        >
          + New zone
        </button>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Define shipping zones (by country) and the rates available in each. A country can only belong to one zone.
        If no zone is defined for a destination, checkout falls back to a €5 flat rate.
      </p>

      {zones.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No zones yet. Create your first zone to enable real shipping rates.
        </div>
      ) : (
        <ul className="space-y-4">
          {zones.map((z) => (
            <li key={z.id} className="rounded border border-[color:var(--color-border)] bg-white p-4">
              <div className="flex items-start gap-2 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold">{z.name}</h2>
                    <span className="text-xs text-[color:var(--color-text-muted)]">{z.countries.length} countries</span>
                  </div>
                  <div className="text-xs text-[color:var(--color-text-muted)] mt-1">
                    {z.countries.length === 0 ? '— no countries assigned —' : z.countries.join(', ')}
                  </div>
                </div>
                <button onClick={() => setEditingZone(z)} className="text-xs hover:underline">Edit</button>
                <button onClick={() => deleteZone(z.id)} className="text-xs text-red-700 hover:underline">Delete</button>
              </div>

              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold">Rates</h3>
                <button
                  onClick={() => setEditingRate({ zoneId: z.id, rate: { kind: 'flat', active: true, flatCents: 500 } })}
                  className="text-xs px-2 py-1 rounded border border-[color:var(--color-border)] hover:bg-gray-50"
                >
                  + Add rate
                </button>
              </div>
              {z.rates.length === 0 ? (
                <p className="text-xs text-[color:var(--color-text-muted)]">No rates yet.</p>
              ) : (
                <ul className="divide-y divide-[color:var(--color-border)] text-sm border border-[color:var(--color-border)] rounded">
                  {z.rates.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-[color:var(--color-text-muted)]">
                          {r.kind === 'flat'
                            ? `flat ${fmtEur(r.flatCents)}`
                            : `weight-based ${fmtEur(r.perKgCents)}/kg${r.minCents ? ` (min ${fmtEur(r.minCents)})` : ''}`}
                          {r.freeOverCents != null && ` · free over ${fmtEur(r.freeOverCents)}`}
                          {!r.active && ' · inactive'}
                        </div>
                      </div>
                      <button onClick={() => setEditingRate({ zoneId: z.id, rate: r })} className="text-xs hover:underline">Edit</button>
                      <button onClick={() => deleteRate(r.id)} className="text-xs text-red-700 hover:underline">Delete</button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {editingZone && (
        <ZoneModal
          value={editingZone}
          onClose={() => setEditingZone(null)}
          onSave={saveZone}
          busy={busy}
        />
      )}
      {editingRate && (
        <RateModal
          rate={editingRate.rate}
          onChange={(r) => setEditingRate({ ...editingRate, rate: r })}
          onClose={() => setEditingRate(null)}
          onSave={saveRate}
          busy={busy}
        />
      )}
    </section>
  );
}

function ZoneModal({
  value, onClose, onSave, busy,
}: {
  value: Partial<Zone>;
  onClose: () => void;
  onSave: (z: Partial<Zone>) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(value.name ?? '');
  const [countriesStr, setCountriesStr] = useState((value.countries ?? []).join(', '));
  const [position, setPosition] = useState(value.position ?? 0);

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">{value.id ? 'Edit zone' : 'New zone'}</h2>
        <label className="block">
          <div className="font-medium mb-1">Name</div>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Countries (comma-separated ISO-2 codes, e.g. FR, DE, BE)</div>
          <input value={countriesStr} onChange={(e) => setCountriesStr(e.target.value)}
            placeholder="FR, DE, BE, NL"
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] uppercase" />
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Each country can only belong to one zone.
          </div>
        </label>
        <label className="block">
          <div className="font-medium mb-1">Position</div>
          <input type="number" value={position} onChange={(e) => setPosition(Number(e.target.value))}
            className="w-32 px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button
            onClick={() => onSave({
              ...value,
              name,
              position,
              countries: countriesStr.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            disabled={busy || !name.trim()}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RateModal({
  rate, onChange, onClose, onSave, busy,
}: {
  rate: Partial<Rate>;
  onChange: (r: Partial<Rate>) => void;
  onClose: () => void;
  onSave: () => void;
  busy: boolean;
}) {
  const update = (patch: Partial<Rate>) => onChange({ ...rate, ...patch });
  const freeOverEuros = rate.freeOverCents == null ? '' : (rate.freeOverCents / 100).toFixed(2);
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">{rate.id ? 'Edit rate' : 'New rate'}</h2>
        <label className="block">
          <div className="font-medium mb-1">Name (shown to customer)</div>
          <input value={rate.name ?? ''} onChange={(e) => update({ name: e.target.value })}
            placeholder="Standard shipping"
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Kind</div>
          <select value={rate.kind ?? 'flat'} onChange={(e) => update({ kind: e.target.value as 'flat' | 'weight' })}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white">
            <option value="flat">Flat fee</option>
            <option value="weight">Weight-based (per kg)</option>
          </select>
        </label>
        {rate.kind === 'weight' ? (
          <>
            <label className="block">
              <div className="font-medium mb-1">Price per kg (€)</div>
              <input type="number" step="0.01"
                value={((rate.perKgCents ?? 0) / 100).toFixed(2)}
                onChange={(e) => update({ perKgCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
            </label>
            <label className="block">
              <div className="font-medium mb-1">Minimum charge (€)</div>
              <input type="number" step="0.01"
                value={((rate.minCents ?? 0) / 100).toFixed(2)}
                onChange={(e) => update({ minCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
            </label>
          </>
        ) : (
          <label className="block">
            <div className="font-medium mb-1">Price (€)</div>
            <input type="number" step="0.01"
              value={((rate.flatCents ?? 0) / 100).toFixed(2)}
              onChange={(e) => update({ flatCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
          </label>
        )}
        <label className="block">
          <div className="font-medium mb-1">Free over (€, optional)</div>
          <input type="number" step="0.01" value={freeOverEuros}
            placeholder="Leave empty to disable"
            onChange={(e) => {
              const v = e.target.value;
              update({ freeOverCents: v === '' ? null : Math.round(parseFloat(v) * 100) });
            }}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={rate.active ?? true} onChange={(e) => update({ active: e.target.checked })} />
          Active (visible at checkout)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={onSave} disabled={busy || !(rate.name ?? '').trim()}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
