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
      <div className="mb-5 flex items-center gap-3">
        <Link href="/content" className="text-sm text-stone-500 hover:underline">← Content</Link>
        <h1 className="h-page">Navigation menus</h1>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}
      <p className="mb-4 text-sm text-stone-500">
        Edit the header and footer links shown on the storefront.
      </p>
      {items.length === 0 ? (
        <div className="empty">No menus yet.</div>
      ) : (
        <div className="card divide-y divide-stone-200/60">
          {items.map((m) => (
            <Link
              key={m.id}
              href={`/content/menus/${m.id}`}
              className="group flex items-center justify-between px-5 py-4 transition-colors hover:bg-stone-50/70"
            >
              <div>
                <div className="text-sm font-medium">{m.name}</div>
                <div className="font-mono text-xs text-stone-500">{m.handle}</div>
              </div>
              <span className="text-stone-400 transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
