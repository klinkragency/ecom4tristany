'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Page = {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published';
  updatedAt: string;
};

export default function PagesListPage() {
  const [items, setItems] = useState<Page[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ items: Page[] }>('/api/admin/content/pages');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <section className="max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Content</Link>
        <h1 className="text-2xl font-semibold flex-1">Pages</h1>
        <Link href="/content/pages/new" className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">+ New page</Link>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No pages yet. Create one — About, FAQ, privacy policy, etc.
        </div>
      ) : (
        <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
          <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Slug</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/content/pages/${p.id}`} className="hover:underline">{p.title}</Link>
                </td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)] font-mono">/{p.slug}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs rounded px-2 py-0.5 ${p.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                  {new Date(p.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
