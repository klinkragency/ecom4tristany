'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
  mustChangePassword: boolean;
  lastLoginAt?: string | null;
  invitedAt?: string | null;
  createdAt: string;
};

export default function UsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ items: AdminUser[] }>('/api/admin/users');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function setRole(id: string, role: AdminUser['role']) {
    try {
      await api(`/api/admin/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Role change failed');
    }
  }

  async function del(u: AdminUser) {
    if (!confirm(`Delete admin ${u.email}? This is irreversible.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function resend(id: string) {
    try {
      const r = await api<{ inviteUrl: string }>(`/api/admin/users/${id}/resend-invite`, { method: 'POST' });
      setInviteUrl(r.inviteUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Resend failed');
    }
  }

  return (
    <div className="max-w-5xl space-y-3">
      <div className="flex items-center justify-end">
        <button onClick={() => setInviteOpen(true)} className="btn btn-primary">+ Invite user</button>
      </div>
      {error && <div className="alert alert-error">{error}</div>}
      {inviteUrl && (
        <div className="alert alert-info">
          <div className="mb-1 font-medium">Invite link generated</div>
          <div className="break-all font-mono text-xs">{inviteUrl}</div>
          <div className="mt-1 text-xs opacity-75">Share this if the email didn&rsquo;t arrive. Valid for 72 hours.</div>
        </div>
      )}

      <table className="table-card">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Last login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id}>
              <td>
                <div className="font-medium">{u.email}</div>
                {u.mustChangePassword && <span className="badge badge-warning no-dot">pending first login</span>}
              </td>
              <td>{u.name}</td>
              <td>
                <select
                  value={u.role}
                  onChange={(e) => setRole(u.id, e.target.value as AdminUser['role'])}
                  className="select w-auto"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </td>
              <td className="text-xs text-stone-500">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
              </td>
              <td className="text-right">
                <div className="flex justify-end gap-1">
                  {u.mustChangePassword && (
                    <button onClick={() => resend(u.id)} className="btn btn-ghost btn-sm">Resend invite</button>
                  )}
                  <button onClick={() => del(u)} className="btn btn-danger btn-sm">Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onDone={async (url) => {
            setInviteOpen(false);
            setInviteUrl(url);
            await load();
          }}
        />
      )}
    </div>
  );
}

function InviteModal({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (url: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AdminUser['role']>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; inviteUrl: string }>('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, name, role }),
      });
      onDone(r.inviteUrl ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invite failed');
      setBusy(false);
    }
  }

  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">Invite an admin</h2>
        {error && <div className="alert alert-error text-xs">{error}</div>}
        <label className="block">
          <span className="label">Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as AdminUser['role'])} className="select">
            <option value="staff">Staff — day-to-day ops, no refunds or deletes</option>
            <option value="admin">Admin — everything except managing admins</option>
            <option value="owner">Owner — full rights</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={busy || !email.trim() || !name.trim()} className="btn btn-primary">
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
