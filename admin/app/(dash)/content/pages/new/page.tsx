'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import PageForm, { EMPTY_PAGE, type PagePayload } from '../PageForm';

export default function NewContentPage() {
  const router = useRouter();
  async function save(p: PagePayload) {
    await api('/api/admin/content/pages', { method: 'POST', body: JSON.stringify(p) });
    router.push('/content/pages');
  }
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content/pages" className="text-sm text-stone-500 hover:underline">← Pages</Link>
        <h1 className="text-2xl font-semibold">New page</h1>
      </div>
      <PageForm initial={EMPTY_PAGE} onSave={save} saveLabel="Create" />
    </section>
  );
}
