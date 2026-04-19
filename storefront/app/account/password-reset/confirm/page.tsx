'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

function PasswordResetConfirmInner() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      await api('/api/customer/auth/password-reset/confirm', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
      setTimeout(() => router.push('/account/login'), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reset failed');
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <section className="mx-auto max-w-sm px-4 py-12 text-center">
        <h1 className="text-xl font-semibold mb-2">Missing token</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
          This link is missing its token. Request a new one.
        </p>
        <Link href="/account/password-reset" className="text-sm underline">Request new link</Link>
      </section>
    );
  }

  if (done) {
    return (
      <section className="mx-auto max-w-sm px-4 py-12 text-center">
        <h1 className="text-xl font-semibold mb-2">Password updated</h1>
        <p className="text-sm text-[color:var(--color-text-muted)]">Redirecting to sign in…</p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold mb-4">Choose a new password</h1>
      <form onSubmit={onSubmit}>
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        )}
        <label className="block text-sm font-medium mb-1" htmlFor="pw">New password (8+ chars)</label>
        <input
          id="pw"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <label className="block text-sm font-medium mb-1" htmlFor="pw2">Confirm password</label>
        <input
          id="pw2"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? 'Updating…' : 'Set new password'}
        </button>
      </form>
    </section>
  );
}

export default function PasswordResetConfirmPage() {
  return (
    <Suspense fallback={<section className="mx-auto max-w-sm px-4 py-12">Loading…</section>}>
      <PasswordResetConfirmInner />
    </Suspense>
  );
}
