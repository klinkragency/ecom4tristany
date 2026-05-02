'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';

export type UserRole = 'owner' | 'admin' | 'staff';

const ROLES: { value: UserRole; label: string }[] = [
  { value: 'owner', label: 'Owner — full rights' },
  { value: 'admin', label: 'Admin — everything except managing admins' },
  { value: 'staff', label: 'Staff — day-to-day ops, no refunds or deletes' },
];

// Inline dialog for changing a single admin user's role. Hides the option
// matching the current role so the user has to pick an actual change.
export function ChangeRoleDialog({
  open,
  userId,
  userEmail,
  currentRole,
  onClose,
  onDone,
}: {
  open: boolean;
  userId: string;
  userEmail: string;
  currentRole: UserRole;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const initial = ROLES.find((r) => r.value !== currentRole)?.value ?? 'staff';
  const [role, setRole] = useState<UserRole>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRole(ROLES.find((r) => r.value !== currentRole)?.value ?? 'staff');
      setErr(null);
    }
  }, [open, currentRole]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Role change failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Change role · ${userEmail}`}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn btn-primary disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Apply role'}
          </button>
        </>
      }
    >
      {err && <div className="alert alert-error text-xs">{err}</div>}
      <label className="block">
        <span className="label">New role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="select">
          {ROLES.filter((r) => r.value !== currentRole).map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-stone-500">Current role: {currentRole}.</p>
    </Modal>
  );
}
