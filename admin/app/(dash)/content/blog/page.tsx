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
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Content</Link>
        <h1 className="text-2xl font-semibold flex-1">Blog</h1>
        <Link href="/content/blog/new" className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">+ New post</Link>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No posts yet.
        </div>
      ) : (
        <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
          <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Author</th>
              <th className="px-3 py-2 font-medium">Tags</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/content/blog/${p.id}`} className="hover:underline">{p.title}</Link>
                  <div className="text-xs text-[color:var(--color-text-muted)] font-mono">/{p.slug}</div>
                </td>
                <td className="px-3 py-2 text-xs">{p.authorName || '—'}</td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">{p.tags.join(', ') || '—'}</td>
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
