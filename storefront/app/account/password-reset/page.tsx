'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

export default function PasswordResetRequestPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api('/api/customer/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <section className="mx-auto max-w-sm px-4 py-12 text-center">
        <h1 className="text-xl font-semibold mb-2">Check your email</h1>
        <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
          If an account exists for {email}, we&rsquo;ve sent a password reset link. The link is valid for one hour.
        </p>
        <Link href="/account/login" className="text-sm underline">
          Back to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold mb-4">Reset your password</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Enter your account email and we&rsquo;ll send you a link to pick a new password.
      </p>
      <form onSubmit={onSubmit}>
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        )}
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-3">
        Remembered it? <Link href="/account/login" className="underline">Sign in</Link>
      </p>
    </section>
  );
}
