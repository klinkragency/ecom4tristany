'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import {
  discountToTypeURL,
  EMPTY_DISCOUNT,
  type DiscountPayload,
} from '../_forms/shared/types';
import AmountOffOrderForm from '../_forms/AmountOffOrderForm';
import AmountOffProductsForm from '../_forms/AmountOffProductsForm';
import BuyXGetYForm from '../_forms/BuyXGetYForm';
import FreeShippingForm from '../_forms/FreeShippingForm';

// The server response uses *omitempty* on nullable / empty-array fields, so a
// few keys can be missing entirely. Normalize against EMPTY_DISCOUNT before
// handing the payload to a form.
type DiscountResponse = Partial<DiscountPayload> & { code?: string | null };

function normalize(d: DiscountResponse): DiscountPayload {
  return {
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
  };
}

export default function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [discount, setDiscount] = useState<DiscountPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<DiscountResponse>(`/api/admin/discounts/${id}`);
        setDiscount(normalize(d));
      } catch {
        setMissing(true);
      }
    })();
  }, [id]);

  if (missing) notFound();
  if (!discount) return <div className="p-6 text-stone-500">Loading…</div>;

  const type = discountToTypeURL(discount);
  switch (type) {
    case 'amount-off-order':    return <AmountOffOrderForm initial={discount} mode="edit" id={id} />;
    case 'amount-off-products': return <AmountOffProductsForm initial={discount} mode="edit" id={id} />;
    case 'buy-x-get-y':         return <BuyXGetYForm initial={discount} mode="edit" id={id} />;
    case 'free-shipping':       return <FreeShippingForm initial={discount} mode="edit" id={id} />;
  }
}
