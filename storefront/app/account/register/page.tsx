'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { identify } from '@/lib/analytics';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const cust = await api<{ id: string; email: string }>('/api/customer/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, firstName, lastName }),
      });
      identify(cust.id, { email: cust.email, firstName, lastName });
      router.push('/account');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm px-4 py-12">
      <h1 className="text-xl font-semibold mb-4">Create account</h1>
      <form onSubmit={onSubmit}>
        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2" role="alert">
            {error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="first">First name</label>
            <input
              id="first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1" htmlFor="last">Last name</label>
            <input
              id="last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </div>
        </div>
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <label className="block text-sm font-medium mb-1" htmlFor="password">Password (8+ chars)</label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-text-muted)] mt-3">
        Already have one? <Link href="/account/login" className="underline">Sign in</Link>
      </p>
    </section>
  );
}
