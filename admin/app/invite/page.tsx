'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

function InviteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/api/admin/auth/invite/accept', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      // Auto-login: the backend set an admin session cookie on the response.
      // Send the invitee straight to the dashboard — no "type your email" step.
      setTimeout(() => { router.push('/'); router.refresh(); }, 800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Accept failed');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <section className="mx-auto max-w-sm px-4 py-12 text-center">
        <h1 className="text-xl font-semibold mb-2">Missing token</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
          This invite link is missing its token. Ask an owner to resend the invite.
        </p>
        <Link href="/login" className="text-sm underline">Back to sign in</Link>
      </section>
    );
  }

  if (done) {
    return (
      <section className="mx-auto max-w-sm px-4 py-12 text-center">
        <h1 className="text-xl font-semibold mb-2">Welcome aboard</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">Redirecting to sign in…</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold mb-1">Accept your invite</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Set a password and you&rsquo;re in.
      </p>
      <form onSubmit={submit}>
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        )}
        <label className="block text-sm font-medium mb-1" htmlFor="pw">New password (8+ chars)</label>
        <input id="pw" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded border border-[color:var(--color-border)]" />
        <label className="block text-sm font-medium mb-1" htmlFor="pw2">Confirm password</label>
        <input id="pw2" type="password" autoComplete="new-password" required minLength={8}
          value={confirm} onChange={(e) => setConfirm(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-[color:var(--color-border)]" />
        <button type="submit" disabled={busy}
          className="w-full px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50">
          {busy ? 'Setting password…' : 'Accept invite'}
        </button>
      </form>
    </section>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-sm px-4 py-12">Loading…</section>}>
      <InviteInner />
    </Suspense>
  );
}
