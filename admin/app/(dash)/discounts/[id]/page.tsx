'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import DiscountForm, { EMPTY_DISCOUNT, type DiscountPayload } from '../DiscountForm';

export default function EditDiscountPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [initial, setInitial] = useState<DiscountPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<Partial<DiscountPayload> & { code?: string | null }>(`/api/admin/discounts/${id}`);
        // Only copy the fields DiscountPayload expects — leaves server-managed
        // ones (id, createdAt, updatedAt, usageCount) out of the save payload.
        setInitial({
          ...EMPTY_DISCOUNT,
          code: d.code ?? '',
          title: d.title ?? '',
          kind: (d.kind as DiscountPayload['kind']) ?? EMPTY_DISCOUNT.kind,
          valuePercent: d.valuePercent ?? null,
          valueCents: d.valueCents ?? null,
          scope: (d.scope as DiscountPayload['scope']) ?? EMPTY_DISCOUNT.scope,
          eligibility: (d.eligibility as DiscountPayload['eligibility']) ?? EMPTY_DISCOUNT.eligibility,
          usageLimit: d.usageLimit ?? null,
          usageLimitPerCustomer: d.usageLimitPerCustomer ?? null,
          minSubtotalCents: d.minSubtotalCents ?? 0,
          bogoBuyQuantity: d.bogoBuyQuantity ?? null,
          bogoGetQuantity: d.bogoGetQuantity ?? null,
          bogoGetDiscountPercent: d.bogoGetDiscountPercent ?? null,
          bogoBuyScope: d.bogoBuyScope ?? null,
          bogoGetScope: d.bogoGetScope ?? null,
          active: d.active ?? true,
          startsAt: d.startsAt ?? null,
          endsAt: d.endsAt ?? null,
          productIds: d.productIds ?? [],
          collectionIds: d.collectionIds ?? [],
          buyProductIds: d.buyProductIds ?? [],
          buyCollectionIds: d.buyCollectionIds ?? [],
          getProductIds: d.getProductIds ?? [],
          getCollectionIds: d.getCollectionIds ?? [],
          segmentIds: d.segmentIds ?? [],
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [id]);

  async function save(p: DiscountPayload) {
    await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(p) });
  }

  async function del() {
    if (!confirm('Delete this discount? Already-applied usages are preserved.')) return;
    try {
      await api(`/api/admin/discounts/${id}`, { method: 'DELETE' });
      router.push('/discounts');
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
        <Link href="/discounts" className="text-sm text-stone-500 hover:underline">← Discounts</Link>
        <h1 className="text-2xl font-semibold flex-1">{initial.title || 'Edit discount'}</h1>
        <button onClick={del} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50">Delete</button>
      </div>
      <DiscountForm initial={initial} onSave={save} saveLabel="Save changes" />
    </section>
  );
}
