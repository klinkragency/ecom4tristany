'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
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

type ReturnSummary = {
  id: string;
  rmaNumber: string;
  status: string;
  requestedAt: string;
};

export default function MyOrderPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [returns, setReturns] = useState<ReturnSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [returnOpen, setReturnOpen] = useState(false);

  async function load() {
    try {
      const [o, r] = await Promise.all([
        api<OrderDetail>(`/api/customer/orders/${params.id}`),
        api<{ items: ReturnSummary[] }>(`/api/customer/returns`).catch(() => ({ items: [] })),
      ]);
      setOrder(o);
      // Client-side filter: only returns for this order.
      setReturns((r.items ?? []).filter((x: ReturnSummary & { orderId?: string }) =>
        (x as unknown as { orderId: string }).orderId === o.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, [params.id]);

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
          {order.storeCreditCents > 0 && (
            <div className="flex justify-between text-green-800"><span>Store credit applied</span><span>−{formatPrice(order.storeCreditCents, order.currency)}</span></div>
          )}
          <div className="flex justify-between text-xs text-[color:var(--color-text-muted)]"><span>incl. VAT</span><span>{formatPrice(order.taxCents, order.currency)}</span></div>
          <div className="flex justify-between font-medium pt-1"><span>Total charged</span><span>{formatPrice(order.totalCents, order.currency)}</span></div>
        </div>
      </div>

      {order.shippingAddress && (
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4 text-sm">
          <h2 className="font-semibold mb-2">Shipping to</h2>
          <div>{order.shippingAddress.firstName} {order.shippingAddress.lastName}</div>
          <div>{order.shippingAddress.addressLine1}</div>
          {order.shippingAddress.addressLine2 && <div>{order.shippingAddress.addressLine2}</div>}
          <div>{order.shippingAddress.postalCode} {order.shippingAddress.city}</div>
          <div>{order.shippingAddress.country}</div>
        </div>
      )}

      {/* Returns section */}
      {(returns.length > 0 || order.financialStatus === 'paid' || order.financialStatus === 'partially_refunded') && (
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 text-sm">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">Returns</h2>
            {(order.financialStatus === 'paid' || order.financialStatus === 'partially_refunded') && (
              <button
                onClick={() => setReturnOpen(true)}
                className="text-xs px-3 py-1 rounded border border-[color:var(--color-border)] hover:bg-gray-50"
              >
                Request a return
              </button>
            )}
          </div>
          {returns.length === 0 ? (
            <p className="text-xs text-[color:var(--color-text-muted)]">No returns yet.</p>
          ) : (
            <ul className="space-y-1">
              {returns.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{r.rmaNumber}</span>
                  <span className="text-[color:var(--color-text-muted)]">{r.status}</span>
                  <span className="text-[color:var(--color-text-muted)] ml-auto">
                    {new Date(r.requestedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {returnOpen && (
        <ReturnModal order={order} onClose={() => setReturnOpen(false)} onDone={async () => { setReturnOpen(false); await load(); }} />
      )}
    </section>
  );
}

function ReturnModal({
  order, onClose, onDone,
}: {
  order: OrderDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>(
    Object.fromEntries(order.lineItems.map((l) => [l.id, 0])),
  );
  const [reasonByLine, setReasonByLine] = useState<Record<string, string>>(
    Object.fromEntries(order.lineItems.map((l) => [l.id, 'other'])),
  );
  const [customerNote, setCustomerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const items = order.lineItems
      .filter((l) => (qtyByLine[l.id] ?? 0) > 0)
      .map((l) => ({
        orderLineItemId: l.id,
        quantity: qtyByLine[l.id]!,
        reason: reasonByLine[l.id] || 'other',
        note: '',
      }));
    if (items.length === 0) {
      setError('Pick at least one item.');
      setSubmitting(false);
      return;
    }
    try {
      await api('/api/customer/returns', {
        method: 'POST',
        body: JSON.stringify({ orderId: order.id, customerNote, items }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Request failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Request a return</h2>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          Select the items you&rsquo;d like to return and tell us why. We&rsquo;ll review and reply
          within 2 business days.
        </p>
        {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">{error}</div>}
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded">
          {order.lineItems.map((l) => (
            <li key={l.id} className="px-3 py-2 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="font-medium">{l.productTitle}</div>
                  {l.variantTitle && <div className="text-xs text-[color:var(--color-text-muted)]">{l.variantTitle}</div>}
                  <div className="text-xs text-[color:var(--color-text-muted)]">Ordered: {l.quantity}</div>
                </div>
                <input
                  type="number" min={0} max={l.quantity}
                  value={qtyByLine[l.id] ?? 0}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(l.quantity, Number(e.target.value)));
                    setQtyByLine((s) => ({ ...s, [l.id]: v }));
                  }}
                  className="w-20 px-2 py-1 rounded border border-[color:var(--color-border)]"
                />
              </div>
              {(qtyByLine[l.id] ?? 0) > 0 && (
                <select
                  value={reasonByLine[l.id] ?? 'other'}
                  onChange={(e) => setReasonByLine((s) => ({ ...s, [l.id]: e.target.value }))}
                  className="w-full text-xs px-2 py-1 rounded border border-[color:var(--color-border)] bg-white"
                >
                  <option value="wrong_item">Wrong item</option>
                  <option value="damaged">Damaged / defective</option>
                  <option value="doesnt_fit">Doesn&rsquo;t fit</option>
                  <option value="changed_mind">Changed my mind</option>
                  <option value="not_as_described">Not as described</option>
                  <option value="other">Other</option>
                </select>
              )}
            </li>
          ))}
        </ul>
        <label className="block">
          <div className="font-medium mb-1">Anything you&rsquo;d like us to know? (optional)</div>
          <textarea rows={3} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={submit} disabled={submitting}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {submitting ? 'Sending…' : 'Submit return request'}
          </button>
        </div>
      </div>
    </div>
  );
}
