'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';

type OrderDetail = {
  id: string;
  number: string;
  status: string;
  financialStatus: string;
  fulfillmentStatus: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  storeCreditCents: number;
  totalCents: number;
  createdAt: string;
  paidAt?: string | null;
  lineItems: {
    id: string;
    productTitle: string;
    variantTitle: string;
    imageUrl: string;
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
  }[];
  shippingAddress?: {
    firstName: string; lastName: string; addressLine1: string; addressLine2: string;
    city: string; postalCode: string; country: string; phone: string;
  };
};

export default function MyOrderPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<OrderDetail>(`/api/customer/orders/${params.id}`)
      .then(setOrder)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, [params.id]);

  if (!order) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-10">
        {error ? <div className="text-red-700 text-sm">{error}</div> : <p>Loading…</p>}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-sm text-[color:var(--color-text-muted)] mb-2">
        <Link href="/account" className="hover:underline">← Account</Link>
      </div>
      <h1 className="text-3xl font-semibold mb-1">{order.number}</h1>
      <div className="text-sm text-[color:var(--color-text-muted)] mb-6">
        {new Date(order.createdAt).toLocaleString()} · {order.status} · {order.financialStatus}
      </div>

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">Items</h2>
        <ul className="divide-y divide-[color:var(--color-border)]">
          {order.lineItems.map((li) => (
            <li key={li.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden shrink-0">
                {li.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={li.imageUrl} alt="" className="w-full h-full object-cover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{li.productTitle}</div>
                {li.variantTitle && <div className="text-xs text-[color:var(--color-text-muted)]">{li.variantTitle}</div>}
                <div className="text-xs text-[color:var(--color-text-muted)]">qty {li.quantity}</div>
              </div>
              <div>{formatPrice(li.totalCents, order.currency)}</div>
            </li>
          ))}
        </ul>
        <div className="border-t border-[color:var(--color-border)] mt-3 pt-3 text-sm space-y-0.5">
          <div className="flex justify-between"><span className="text-[color:var(--color-text-muted)]">Subtotal</span><span>{formatPrice(order.subtotalCents, order.currency)}</span></div>
          <div className="flex justify-between"><span className="text-[color:var(--color-text-muted)]">Shipping</span><span>{formatPrice(order.shippingCents, order.currency)}</span></div>
          {order.storeCreditCents > 0 && (
            <div className="flex justify-between text-green-800"><span>Store credit applied</span><span>−{formatPrice(order.storeCreditCents, order.currency)}</span></div>
          )}
          <div className="flex justify-between text-xs text-[color:var(--color-text-muted)]"><span>incl. VAT</span><span>{formatPrice(order.taxCents, order.currency)}</span></div>
          <div className="flex justify-between font-medium pt-1"><span>Total charged</span><span>{formatPrice(order.totalCents, order.currency)}</span></div>
        </div>
      </div>

      {order.shippingAddress && (
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 text-sm">
          <h2 className="font-semibold mb-2">Shipping to</h2>
          <div>{order.shippingAddress.firstName} {order.shippingAddress.lastName}</div>
          <div>{order.shippingAddress.addressLine1}</div>
          {order.shippingAddress.addressLine2 && <div>{order.shippingAddress.addressLine2}</div>}
          <div>{order.shippingAddress.postalCode} {order.shippingAddress.city}</div>
          <div>{order.shippingAddress.country}</div>
        </div>
      )}
    </section>
  );
}
