'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

type Me = { id: string; email: string; firstName: string; lastName: string };

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Me>('/api/customer/me')
      .then(setMe)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  async function logout() {
    try {
      await api('/api/customer/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/account/login');
      router.refresh();
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-4">Your account</h1>
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
      )}
      {me && (
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
          <p>
            <span className="text-[color:var(--color-text-muted)]">Name: </span>
            {me.firstName || me.lastName ? `${me.firstName} ${me.lastName}` : '—'}
          </p>
          <p>
            <span className="text-[color:var(--color-text-muted)]">Email: </span>
            {me.email}
          </p>
        </div>
      )}
      <button
        onClick={logout}
        className="px-3 py-2 rounded border border-[color:var(--color-border)] text-sm hover:bg-gray-50"
      >
        Sign out
      </button>
    </section>
  );
}
