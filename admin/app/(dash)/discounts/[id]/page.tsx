'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import {
  discountToTypeURL,
  normalizeDiscount,
  type DiscountPayload,
  type DiscountResponse,
} from '../_forms/shared/types';
import AmountOffOrderForm from '../_forms/AmountOffOrderForm';
import AmountOffProductsForm from '../_forms/AmountOffProductsForm';
import BuyXGetYForm from '../_forms/BuyXGetYForm';
import FreeShippingForm from '../_forms/FreeShippingForm';

export default function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [discount, setDiscount] = useState<DiscountPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<DiscountResponse>(`/api/admin/discounts/${id}`);
        setDiscount(normalizeDiscount(d));
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
