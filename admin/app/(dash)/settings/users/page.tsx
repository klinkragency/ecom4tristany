'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog, RowActionsMenu, Select, type RowAction } from '@/components/ui';
import { ChangeRoleDialog, type UserRole } from './ChangeRoleDialog';

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
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
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null);
  const [roleFor, setRoleFor] = useState<AdminUser | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ items: AdminUser[] }>('/api/admin/users');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function resend(u: AdminUser) {
    try {
      const r = await api<{ inviteUrl: string }>(`/api/admin/users/${u.id}/resend-invite`, { method: 'POST' });
      setInviteUrl(r.inviteUrl);
      setFlashId(u.id);
      window.setTimeout(() => setFlashId((cur) => (cur === u.id ? null : cur)), 3000);
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
            <th className="w-12"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => {
            const actions: RowAction[] = [
              {
                label: 'Change role',
                onClick: () => setRoleFor(u),
              },
            ];
            if (u.mustChangePassword) {
              actions.push({
                label: 'Resend invite',
                onClick: () => resend(u),
              });
            }
            actions.push({
              label: 'Delete admin',
              destructive: true,
              onClick: () => setPendingDelete(u),
            });
            return (
              <tr key={u.id}>
                <td>
                  <div className="font-medium">{u.email}</div>
                  {u.mustChangePassword && <span className="badge badge-warning no-dot">pending first login</span>}
                  {flashId === u.id && (
                    <span className="ml-2 text-xs font-medium text-emerald-600">Invite resent</span>
                  )}
                </td>
                <td>{u.name}</td>
                <td className="capitalize">{u.role}</td>
                <td className="text-xs text-stone-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}
                </td>
                <td>
                  <RowActionsMenu label={`Actions for ${u.email}`} actions={actions} />
                </td>
              </tr>
            );
          })}
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

      {roleFor && (
        <ChangeRoleDialog
          open
          userId={roleFor.id}
          userEmail={roleFor.email}
          currentRole={roleFor.role}
          onClose={() => setRoleFor(null)}
          onDone={async () => {
            setRoleFor(null);
            await load();
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={pendingDelete ? `Delete admin ${pendingDelete.email}?` : ''}
        description="This is irreversible. The user will lose access immediately."
        confirmLabel="Delete admin"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await api(`/api/admin/users/${pendingDelete.id}`, { method: 'DELETE' });
          setPendingDelete(null);
          await load();
        }}
      />
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
  const [role, setRole] = useState<UserRole>('staff');
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
        <div className="block">
          <span className="label">Role</span>
          <Select<UserRole>
            ariaLabel="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'staff', label: 'Staff — day-to-day ops, no refunds or deletes' },
              { value: 'admin', label: 'Admin — everything except managing admins' },
              { value: 'owner', label: 'Owner — full rights' },
            ]}
          />
        </div>
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
