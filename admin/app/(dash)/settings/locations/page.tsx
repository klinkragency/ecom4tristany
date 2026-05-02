'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Location } from '@/lib/types';
import { ConfirmDialog } from '@/components/ui';

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Location> | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  async function load() {
    try {
      setLocations(await api<Location[]>('/api/admin/locations'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: editing.name ?? '',
        isActive: editing.isActive ?? true,
        isFulfillment: editing.isFulfillment ?? true,
        addressLine1: editing.addressLine1 ?? '',
        addressLine2: editing.addressLine2 ?? '',
        city: editing.city ?? '',
        region: editing.region ?? '',
        postalCode: editing.postalCode ?? '',
        country: editing.country ?? '',
        phone: editing.phone ?? '',
      };
      if (editing.id) {
        await api(`/api/admin/locations/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/api/admin/locations', { method: 'POST', body: JSON.stringify(body) });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="max-w-3xl space-y-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setEditing({
            name: '', isActive: true, isFulfillment: true,
            addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', country: '', phone: '',
          })}
          className="btn btn-primary"
        >
          Add location
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!locations ? (
        <div className="empty">Loading…</div>
      ) : locations.length === 0 ? (
        <div className="empty">No locations yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th>Active</th>
              <th>Fulfillment</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.name}</td>
                <td className="text-stone-500">
                  {[l.city, l.region, l.country].filter(Boolean).join(', ') || '—'}
                </td>
                <td>
                  <span className={`badge ${l.isActive ? 'badge-success' : 'badge-neutral'}`}>
                    {l.isActive ? 'active' : 'inactive'}
                  </span>
                </td>
                <td>
                  {l.isFulfillment
                    ? <span className="badge badge-info no-dot">fulfillment</span>
                    : <span className="text-stone-400">—</span>}
                </td>
                <td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => setEditing(l)} className="btn btn-ghost btn-sm">Edit</button>
                    <button onClick={() => setPendingDeleteId(l.id)} className="btn btn-danger btn-sm">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
            <h2 className="text-base font-semibold">{editing.id ? 'Edit location' : 'New location'}</h2>
            <LabelledInput label="Name" value={editing.name ?? ''} onChange={(v) => setEditing({ ...editing, name: v })} />
            <div className="grid grid-cols-2 gap-2">
              <Toggle label="Active" checked={!!editing.isActive} onChange={(v) => setEditing({ ...editing, isActive: v })} />
              <Toggle label="Fulfillment" checked={!!editing.isFulfillment} onChange={(v) => setEditing({ ...editing, isFulfillment: v })} />
            </div>
            <LabelledInput label="Address line 1" value={editing.addressLine1 ?? ''} onChange={(v) => setEditing({ ...editing, addressLine1: v })} />
            <LabelledInput label="Address line 2" value={editing.addressLine2 ?? ''} onChange={(v) => setEditing({ ...editing, addressLine2: v })} />
            <div className="grid grid-cols-3 gap-2">
              <LabelledInput label="City" value={editing.city ?? ''} onChange={(v) => setEditing({ ...editing, city: v })} />
              <LabelledInput label="Region" value={editing.region ?? ''} onChange={(v) => setEditing({ ...editing, region: v })} />
              <LabelledInput label="Postal code" value={editing.postalCode ?? ''} onChange={(v) => setEditing({ ...editing, postalCode: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <LabelledInput label="Country" value={editing.country ?? ''} onChange={(v) => setEditing({ ...editing, country: v })} />
              <LabelledInput label="Phone" value={editing.phone ?? ''} onChange={(v) => setEditing({ ...editing, phone: v })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="btn btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete location?"
        description="Inventory levels at this location will be lost."
        confirmLabel="Delete"
        destructive
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={async () => {
          if (!pendingDeleteId) return;
          await api(`/api/admin/locations/${pendingDeleteId}`, { method: 'DELETE' });
          setPendingDeleteId(null);
          await load();
        }}
      />
    </div>
  );
}

function LabelledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input" />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pt-5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
