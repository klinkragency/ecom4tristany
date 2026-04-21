'use client';

import { useState } from 'react';
import Link from 'next/link';
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
      <section className="max-w-md">
        <div className="rounded border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">
          Password updated.
        </div>
      </section>
    );
  }

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)]';
  return (
    <section className="max-w-md">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold">Change password</h1>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3 text-sm">
        <label className="block">
          <div className="font-medium mb-1">Current password</div>
          <input type="password" autoComplete="current-password" className={input}
            value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
        <label className="block">
          <div className="font-medium mb-1">New password (8+ chars)</div>
          <input type="password" autoComplete="new-password" minLength={8} className={input}
            value={next1} onChange={(e) => setNext1(e.target.value)} />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Confirm new password</div>
          <input type="password" autoComplete="new-password" minLength={8} className={input}
            value={next2} onChange={(e) => setNext2(e.target.value)} />
        </label>
        <div className="flex justify-end pt-1">
          <button onClick={submit} disabled={busy}
            className="px-4 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Update password'}
          </button>
        </div>
      </div>
    </section>
  );
}
