'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next1, setNext1] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    setError(null);
    if (next1.length < 8) { setError('New password must be at least 8 characters.'); return; }
    if (next1 !== next2) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/api/admin/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next1 }),
      });
      setDone(true);
      setTimeout(() => router.push('/'), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Change failed');
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-md">
        <div className="alert alert-success">Password updated.</div>
      </div>
    );
  }

  return (
    <div className="max-w-md space-y-3">
      {error && <div className="alert alert-error">{error}</div>}
      <div className="card card-pad space-y-3">
        <label className="block">
          <span className="label">Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            className="input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">New password (8+ chars)</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="input"
            value={next1}
            onChange={(e) => setNext1(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="label">Confirm new password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            className="input"
            value={next2}
            onChange={(e) => setNext2(e.target.value)}
          />
        </label>
        <div className="flex justify-end pt-1">
          <button onClick={submit} disabled={busy} className="btn btn-primary">
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </div>
    </div>
  );
}
