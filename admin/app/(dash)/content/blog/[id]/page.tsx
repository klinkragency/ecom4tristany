'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import BlogForm, { EMPTY_POST, type BlogPayload } from '../BlogForm';

export default function EditBlogPost() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [initial, setInitial] = useState<BlogPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<Partial<BlogPayload>>(`/api/admin/content/blog/${id}`);
        setInitial({
          ...EMPTY_POST,
          slug: d.slug ?? '',
          title: d.title ?? '',
          excerpt: d.excerpt ?? '',
          contentHtml: d.contentHtml ?? '',
          authorName: d.authorName ?? '',
          featuredImageUrl: d.featuredImageUrl ?? '',
          metaDescription: d.metaDescription ?? '',
          status: (d.status as 'draft' | 'published') ?? 'draft',
          tags: d.tags ?? [],
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [id]);

  async function save(p: BlogPayload) {
    await api(`/api/admin/content/blog/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }

  async function del() {
    if (!confirm('Delete this post?')) return;
    try {
      await api(`/api/admin/content/blog/${id}`, { method: 'DELETE' });
      router.push('/content/blog');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!initial) {
    return <section><p className="text-stone-500">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content/blog" className="text-sm text-stone-500 hover:underline">← Blog</Link>
        <h1 className="h-page">{initial.title || 'Edit post'}</h1>
      </div>
      <BlogForm initial={initial} onSave={save} saveLabel="Save changes" onDelete={del} />
    </section>
  );
}
