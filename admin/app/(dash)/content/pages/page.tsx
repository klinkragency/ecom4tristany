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
      <div className="mb-5 flex items-center gap-3">
        <Link href="/content" className="text-sm text-stone-500 hover:underline">← Content</Link>
        <h1 className="h-page flex-1">Pages</h1>
        <Link href="/content/pages/new" className="btn btn-primary">+ New page</Link>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {items.length === 0 ? (
        <div className="empty">No pages yet. Create one — About, FAQ, privacy policy, etc.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">
                  <Link href={`/content/pages/${p.id}`} className="hover:underline">{p.title}</Link>
                </td>
                <td className="font-mono text-xs text-stone-500">/{p.slug}</td>
                <td>
                  <span className={`badge ${p.status === 'published' ? 'badge-success' : 'badge-neutral'}`}>
                    {p.status}
                  </span>
                </td>
                <td className="text-xs text-stone-500">{new Date(p.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
