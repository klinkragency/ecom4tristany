'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Post = {
  id: string;
  slug: string;
  title: string;
  authorName: string;
  status: 'draft' | 'published';
  publishedAt?: string | null;
  updatedAt: string;
  tags: string[];
};

export default function BlogListPage() {
  const [items, setItems] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: Post[] }>('/api/admin/content/blog');
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, []);

  return (
    <section className="max-w-5xl">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/content" className="text-sm text-stone-500 hover:underline">← Content</Link>
        <h1 className="h-page flex-1">Blog</h1>
        <Link href="/content/blog/new" className="btn btn-primary">+ New post</Link>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {items.length === 0 ? (
        <div className="empty">No posts yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Tags</th>
              <th>Status</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">
                  <Link href={`/content/blog/${p.id}`} className="hover:underline">{p.title}</Link>
                  <div className="font-mono text-xs text-stone-500">/{p.slug}</div>
                </td>
                <td className="text-xs">{p.authorName || '—'}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {p.tags.length === 0
                      ? <span className="text-stone-400">—</span>
                      : p.tags.map((t) => <span key={t} className="badge badge-neutral no-dot">{t}</span>)}
                  </div>
                </td>
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
