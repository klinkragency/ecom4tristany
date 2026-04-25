'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import TypeForm, { EMPTY_TYPE, type TypePayload } from '../TypeForm';

export default function NewTypePage() {
  const router = useRouter();
  async function save(p: TypePayload) {
    const created = await api<{ id: string }>('/api/admin/content/metaobjects/types', {
      method: 'POST', body: JSON.stringify(p),
    });
    router.push(`/content/metaobjects/${created.id}`);
  }
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content/metaobjects" className="text-sm text-stone-500 hover:underline">← Metaobjects</Link>
        <h1 className="text-2xl font-semibold">New type</h1>
      </div>
      <TypeForm initial={EMPTY_TYPE} onSave={save} saveLabel="Create" />
    </section>
  );
}
