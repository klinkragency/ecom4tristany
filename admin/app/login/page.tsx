'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg bg-white border border-[color:var(--color-border)] p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold mb-4">Admin sign in</h1>
        {error && (
          <div
            className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2"
            role="alert"
          >
            {error}
          </div>
        )}
        <label className="block text-sm font-medium mb-1" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-3 py-2 rounded border border-[color:var(--color-border)] focus:outline-none focus:ring-2 focus:ring-black"
        />
        <label className="block text-sm font-medium mb-1" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full mb-4 px-3 py-2 rounded border border-[color:var(--color-border)] focus:outline-none focus:ring-2 focus:ring-black"
        />
        <button
          type="submit"
          disabled={pending}
          className="w-full px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
