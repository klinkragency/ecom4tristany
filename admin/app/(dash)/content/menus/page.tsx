'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Menu = {
  id: string;
  handle: string;
  name: string;
};

export default function MenusListPage() {
  const [items, setItems] = useState<Menu[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: Menu[] }>('/api/admin/content/menus');
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, []);

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Content</Link>
        <h1 className="text-2xl font-semibold">Navigation menus</h1>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Edit the header and footer links shown on the storefront.
      </p>
      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
        {items.map((m) => (
          <li key={m.id}>
            <Link href={`/content/menus/${m.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-sm">
              <div>
                <div className="font-medium">{m.name}</div>
                <div className="text-xs text-[color:var(--color-text-muted)] font-mono">{m.handle}</div>
              </div>
              <span className="text-[color:var(--color-text-muted)]">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
