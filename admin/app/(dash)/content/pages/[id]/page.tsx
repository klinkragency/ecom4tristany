'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import PageForm, { EMPTY_PAGE, type PagePayload } from '../PageForm';

export default function EditContentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [initial, setInitial] = useState<PagePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<Partial<PagePayload>>(`/api/admin/content/pages/${id}`);
        setInitial({
          ...EMPTY_PAGE,
          slug: d.slug ?? '',
          title: d.title ?? '',
          contentHtml: d.contentHtml ?? '',
          excerpt: d.excerpt ?? '',
          metaDescription: d.metaDescription ?? '',
          status: (d.status as 'draft' | 'published') ?? 'draft',
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [id]);

  async function save(p: PagePayload) {
    await api(`/api/admin/content/pages/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }

  async function del() {
    if (!confirm('Delete this page?')) return;
    try {
      await api(`/api/admin/content/pages/${id}`, { method: 'DELETE' });
      router.push('/content/pages');
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
        <Link href="/content/pages" className="text-sm text-stone-500 hover:underline">← Pages</Link>
        <h1 className="text-2xl font-semibold">{initial.title || 'Edit page'}</h1>
      </div>
      <PageForm initial={initial} onSave={save} saveLabel="Save changes" onDelete={del} />
    </section>
  );
}
