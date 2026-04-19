'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Location } from '@/lib/types';

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Location> | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function del(id: string) {
    if (!confirm('Delete this location?')) return;
    try {
      await api(`/api/admin/locations/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Locations</h1>
        <button
          onClick={() => setEditing({
            name: '', isActive: true, isFulfillment: true,
            addressLine1: '', addressLine2: '', city: '', region: '', postalCode: '', country: '', phone: '',
          })}
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
        >
          Add location
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded border border-[color:var(--color-border)] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Address</th>
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2 font-medium">Fulfillment</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {!locations && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-[color:var(--color-text-muted)]">Loading…</td></tr>
            )}
            {locations?.map((l) => (
              <tr key={l.id} className="border-t border-[color:var(--color-border)]">
                <td className="px-3 py-2 font-medium">{l.name}</td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                  {[l.city, l.region, l.country].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-3 py-2">{l.isActive ? '✓' : '—'}</td>
                <td className="px-3 py-2">{l.isFulfillment ? '✓' : '—'}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(l)} className="text-sm hover:underline mr-3">
                    Edit
                  </button>
                  <button onClick={() => del(l.id)} className="text-sm text-red-700 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
            <h2 className="font-semibold">{editing.id ? 'Edit location' : 'New location'}</h2>
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
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-2 rounded border border-[color:var(--color-border)]"
              >Cancel</button>
              <button
                onClick={save}
                disabled={saving}
                className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50"
              >{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function LabelledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[color:var(--color-text-muted)] mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded border border-[color:var(--color-border)]"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 pt-4">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
