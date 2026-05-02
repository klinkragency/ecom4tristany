'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog, Select } from '@/components/ui';

type Pending =
  | { kind: 'zone'; id: string }
  | { kind: 'rate'; id: string }
  | null;

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
  const [pending, setPending] = useState<Pending>(null);

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


  return (
    <div className="max-w-4xl space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          Define shipping zones (by country) and the rates available in each. A country can only belong to one zone.
          If no zone is defined for a destination, checkout falls back to a €5 flat rate.
        </p>
        <button
          onClick={() => setEditingZone({ name: '', countries: [], position: 0 })}
          className="btn btn-primary shrink-0"
        >
          + New zone
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {zones.length === 0 ? (
        <div className="empty">No zones yet. Create your first zone to enable real shipping rates.</div>
      ) : (
        <div className="space-y-3">
          {zones.map((z) => (
            <div key={z.id} className="card card-pad">
              <div className="mb-4 flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">{z.name}</h2>
                    <span className="badge badge-neutral no-dot">{z.countries.length} countries</span>
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    {z.countries.length === 0 ? 'No countries assigned' : z.countries.join(', ')}
                  </div>
                </div>
                <button onClick={() => setEditingZone(z)} className="btn btn-ghost btn-sm">Edit</button>
                <button onClick={() => setPending({ kind: 'zone', id: z.id })} className="btn btn-danger btn-sm">Delete</button>
              </div>

              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Rates</h3>
                <button
                  onClick={() => setEditingRate({ zoneId: z.id, rate: { kind: 'flat', active: true, flatCents: 500 } })}
                  className="btn btn-secondary btn-sm"
                >
                  + Add rate
                </button>
              </div>
              {z.rates.length === 0 ? (
                <p className="text-xs text-stone-500">No rates yet.</p>
              ) : (
                <div className="rounded-xl border border-stone-200 divide-y divide-stone-200/70">
                  {z.rates.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <div className="flex-1">
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-stone-500">
                          {r.kind === 'flat'
                            ? `flat ${fmtEur(r.flatCents)}`
                            : `weight-based ${fmtEur(r.perKgCents)}/kg${r.minCents ? ` (min ${fmtEur(r.minCents)})` : ''}`}
                          {r.freeOverCents != null && ` · free over ${fmtEur(r.freeOverCents)}`}
                        </div>
                      </div>
                      {!r.active && <span className="badge badge-neutral no-dot">inactive</span>}
                      <button onClick={() => setEditingRate({ zoneId: z.id, rate: r })} className="btn btn-ghost btn-sm">Edit</button>
                      <button onClick={() => setPending({ kind: 'rate', id: r.id })} className="btn btn-danger btn-sm">Delete</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
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

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'zone' ? 'Delete shipping zone?' : 'Delete shipping rate?'}
        description={pending?.kind === 'zone' ? 'All rates inside this zone will also be deleted. This cannot be undone.' : undefined}
        confirmLabel="Delete"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === 'zone') {
            await api(`/api/admin/shipping/zones/${pending.id}`, { method: 'DELETE' });
          } else {
            await api(`/api/admin/shipping/rates/${pending.id}`, { method: 'DELETE' });
          }
          setPending(null);
          await load();
        }}
      />
    </div>
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
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">{value.id ? 'Edit zone' : 'New zone'}</h2>
        <label className="block">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </label>
        <label className="block">
          <span className="label">Countries (comma-separated ISO-2 codes)</span>
          <input
            value={countriesStr}
            onChange={(e) => setCountriesStr(e.target.value)}
            placeholder="FR, DE, BE, NL"
            className="input uppercase"
          />
          <span className="help">Each country can only belong to one zone.</span>
        </label>
        <label className="block">
          <span className="label">Position</span>
          <input
            type="number"
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            className="input w-32"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => onSave({
              ...value,
              name,
              position,
              countries: countriesStr.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
            })}
            disabled={busy || !name.trim()}
            className="btn btn-primary"
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
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">{rate.id ? 'Edit rate' : 'New rate'}</h2>
        <label className="block">
          <span className="label">Name (shown to customer)</span>
          <input
            value={rate.name ?? ''}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Standard shipping"
            className="input"
          />
        </label>
        <div className="block">
          <span className="label">Kind</span>
          <Select<'flat' | 'weight'>
            ariaLabel="Kind"
            value={rate.kind ?? 'flat'}
            onChange={(v) => update({ kind: v })}
            options={[
              { value: 'flat', label: 'Flat fee' },
              { value: 'weight', label: 'Weight-based (per kg)' },
            ]}
          />
        </div>
        {rate.kind === 'weight' ? (
          <>
            <label className="block">
              <span className="label">Price per kg (€)</span>
              <input
                type="number"
                step="0.01"
                value={((rate.perKgCents ?? 0) / 100).toFixed(2)}
                onChange={(e) => update({ perKgCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                className="input"
              />
            </label>
            <label className="block">
              <span className="label">Minimum charge (€)</span>
              <input
                type="number"
                step="0.01"
                value={((rate.minCents ?? 0) / 100).toFixed(2)}
                onChange={(e) => update({ minCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
                className="input"
              />
            </label>
          </>
        ) : (
          <label className="block">
            <span className="label">Price (€)</span>
            <input
              type="number"
              step="0.01"
              value={((rate.flatCents ?? 0) / 100).toFixed(2)}
              onChange={(e) => update({ flatCents: Math.round(parseFloat(e.target.value || '0') * 100) })}
              className="input"
            />
          </label>
        )}
        <label className="block">
          <span className="label">Free over (€, optional)</span>
          <input
            type="number"
            step="0.01"
            value={freeOverEuros}
            placeholder="Leave empty to disable"
            onChange={(e) => {
              const v = e.target.value;
              update({ freeOverCents: v === '' ? null : Math.round(parseFloat(v) * 100) });
            }}
            className="input"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={rate.active ?? true} onChange={(e) => update({ active: e.target.checked })} />
          Active (visible at checkout)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={onSave} disabled={busy || !(rate.name ?? '').trim()} className="btn btn-primary">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
