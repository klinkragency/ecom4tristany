'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import BlogForm, { EMPTY_POST, type BlogPayload } from '../BlogForm';

export default function NewBlogPost() {
  const router = useRouter();
  async function save(p: BlogPayload) {
    await api('/api/admin/content/blog', { method: 'POST', body: JSON.stringify(p) });
    router.push('/content/blog');
  }
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content/blog" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Blog</Link>
        <h1 className="text-2xl font-semibold">New post</h1>
      </div>
      <BlogForm initial={EMPTY_POST} onSave={save} saveLabel="Create" />
    </section>
  );
}
