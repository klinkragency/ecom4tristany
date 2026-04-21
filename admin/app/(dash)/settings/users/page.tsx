'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
    <section className="max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold flex-1">Admin users</h1>
        <button onClick={() => setInviteOpen(true)} className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">+ Invite user</button>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {inviteUrl && (
        <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
          <div className="font-medium mb-1">Invite link generated</div>
          <div className="font-mono text-xs break-all">{inviteUrl}</div>
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Share this if the email didn&rsquo;t arrive. Valid for 72 hours.
          </div>
        </div>
      )}

      <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
        <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
          <tr className="text-left">
            <th className="px-3 py-2 font-medium">Email</th>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Last login</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={u.id} className="border-b border-[color:var(--color-border)]">
              <td className="px-3 py-2">
                <div className="font-medium">{u.email}</div>
                {u.mustChangePassword && <div className="text-xs text-amber-800">pending first login</div>}
              </td>
              <td className="px-3 py-2">{u.name}</td>
              <td className="px-3 py-2">
                <select value={u.role} onChange={(e) => setRole(u.id, e.target.value as AdminUser['role'])}
                  className="px-2 py-1 text-xs rounded border border-[color:var(--color-border)] bg-white">
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="staff">Staff</option>
                </select>
              </td>
              <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {u.mustChangePassword && (
                  <button onClick={() => resend(u.id)} className="text-xs hover:underline mr-3">Resend invite</button>
                )}
                <button onClick={() => del(u)} className="text-xs text-red-700 hover:underline">Delete</button>
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
    </section>
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

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm';
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Invite an admin</h2>
        {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">{error}</div>}
        <label className="block">
          <div className="font-medium mb-1">Email</div>
          <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Name</div>
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Role</div>
          <select value={role} onChange={(e) => setRole(e.target.value as AdminUser['role'])}
            className={input + ' bg-white'}>
            <option value="staff">Staff — day-to-day ops, no refunds or deletes</option>
            <option value="admin">Admin — everything except managing admins</option>
            <option value="owner">Owner — full rights</option>
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={submit} disabled={busy || !email.trim() || !name.trim()}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
