'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { cartStore } from '@/lib/cart-store';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/types';

type Order = {
  id: string;
  number: string;
  email: string;
  status: string;
  financialStatus: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  paidAt?: string | null;
  lineItems: {
    id: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    imageUrl: string;
    unitPriceCents: number;
    quantity: number;
    totalCents: number;
  }[];
  shippingAddress?: {
    firstName: string; lastName: string; addressLine1: string;
    city: string; postalCode: string; country: string;
  };
};

export default function CheckoutSuccessPage() {
  const params = useSearchParams();
  const orderId = params.get('orderId');
  const redirectStatus = params.get('redirect_status'); // stripe adds this

  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [polling, setPolling] = useState(true);

  useEffect(() => {
    if (!orderId) {
      setError('Missing orderId');
      setPolling(false);
      return;
    }
    let cancelled = false;
    let attempts = 0;

    async function pollOnce(): Promise<void> {
      attempts += 1;
      try {
        const o = await api<Order>(`/api/storefront/orders/${orderId}`);
        if (cancelled) return;
        setOrder(o);
        // Stop polling once we see a terminal financial state or we've tried enough times.
        if (o.financialStatus === 'paid' || attempts > 20) {
          setPolling(false);
          cartStore.set({ cart: null });
          if (o.financialStatus === 'paid') {
            track('checkout_completed', {
              orderId: o.id,
              payload: { totalCents: o.totalCents, orderNumber: o.number },
            });
          }
          return;
        }
        setTimeout(pollOnce, 1500);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Lookup failed');
        setPolling(false);
      }
    }
    void pollOnce();
    return () => { cancelled = true; };
  }, [orderId]);

  if (error) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
        <p className="text-[color:var(--color-text-muted)]">{error}</p>
        <Link href="/" className="inline-block mt-4 px-4 py-2 rounded border border-[color:var(--color-border)]">
          Back to home
        </Link>
      </section>
    );
  }

  if (!order) {
    return (
      <section className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-[color:var(--color-text-muted)]">Confirming your order…</p>
      </section>
    );
  }

  const isPaid = order.financialStatus === 'paid';

  return (
    <section className="mx-auto max-w-2xl px-4 py-12">
      <div className="text-center mb-8">
        <div className="inline-block rounded-full bg-green-100 text-green-700 w-16 h-16 grid place-items-center text-3xl mb-3">
          {isPaid ? '✓' : '…'}
        </div>
        <h1 className="text-3xl font-semibold mb-1">
          {isPaid ? 'Thank you!' : 'Almost there'}
        </h1>
        <p className="text-[color:var(--color-text-muted)]">
          {isPaid
            ? `Order ${order.number} confirmed. A receipt has been sent to ${order.email}.`
            : redirectStatus === 'succeeded'
              ? 'Your payment succeeded and we\'re finalizing your order…'
              : `Payment status: ${order.financialStatus}. We\'ll email you when it clears.`}
          {polling && ' ⏳'}
        </p>
      </div>

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-3">Items</h2>
        <ul className="divide-y divide-[color:var(--color-border)]">
          {order.lineItems.map((li) => (
            <li key={li.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-gray-100">
                {li.imageUrl && (
                  <Image src={li.imageUrl} alt="" fill sizes="48px" className="object-cover" />
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
          <div className="flex justify-between text-xs text-[color:var(--color-text-muted)]"><span>incl. VAT</span><span>{formatPrice(order.taxCents, order.currency)}</span></div>
          <div className="flex justify-between font-medium pt-1"><span>Total</span><span>{formatPrice(order.totalCents, order.currency)}</span></div>
        </div>
      </div>

      {order.shippingAddress && (
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4 text-sm">
          <h2 className="font-semibold mb-2">Shipping to</h2>
          <div>{order.shippingAddress.firstName} {order.shippingAddress.lastName}</div>
          <div>{order.shippingAddress.addressLine1}</div>
          <div>{order.shippingAddress.postalCode} {order.shippingAddress.city} · {order.shippingAddress.country}</div>
        </div>
      )}

      <div className="text-center">
        <Link href="/products" className="inline-block px-4 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]">
          Keep shopping
        </Link>
      </div>
    </section>
  );
}
