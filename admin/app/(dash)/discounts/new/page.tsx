'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import DiscountForm, { EMPTY_DISCOUNT, type DiscountPayload } from '../DiscountForm';

export default function NewDiscountPage() {
  const router = useRouter();
  async function save(p: DiscountPayload) {
    const created = await api<{ id: string }>('/api/admin/discounts', {
      method: 'POST',
      body: JSON.stringify(p),
    });
    router.push(`/discounts/${created.id}`);
  }
  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href="/discounts" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Discounts</Link>
        <h1 className="text-2xl font-semibold">New discount</h1>
      </div>
      <DiscountForm initial={EMPTY_DISCOUNT} onSave={save} saveLabel="Create" />
    </section>
  );
}
