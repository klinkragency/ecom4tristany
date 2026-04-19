'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type Order, type FinancialStatus, type FulfillmentStatus } from '@/lib/types';

const FIN_BADGE: Record<FinancialStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  authorized: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  partially_paid: 'bg-amber-100 text-amber-800',
  refunded: 'bg-red-100 text-red-800',
  partially_refunded: 'bg-red-100 text-red-800',
  voided: 'bg-gray-100 text-gray-800',
};

const FUL_BADGE: Record<FulfillmentStatus, string> = {
  unfulfilled: 'bg-gray-100 text-gray-800',
  partial: 'bg-amber-100 text-amber-800',
  fulfilled: 'bg-green-100 text-green-800',
  restocked: 'bg-gray-100 text-gray-800',
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setOrder(await api<Order>(`/api/admin/orders/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, [id]);

  async function cancel() {
    if (!confirm('Cancel this order?')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/orders/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(note: string) {
    setBusy(true);
    try {
      await api(`/api/admin/orders/${id}/note`, { method: 'PUT', body: JSON.stringify({ note }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveTags(tagsStr: string) {
    const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
    setBusy(true);
    try {
      await api(`/api/admin/orders/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <section>
        <p className="text-[color:var(--color-text-muted)]">Loading…</p>
        {error && <div className="mt-3 text-red-700 text-sm">{error}</div>}
      </section>
    );
  }

  return (
    <section className="max-w-5xl grid md:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/orders" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Orders</Link>
          <h1 className="text-2xl font-semibold">{order.number}</h1>
          <span className={`inline-block rounded px-2 py-0.5 text-xs ${FIN_BADGE[order.financialStatus]}`}>
            {order.financialStatus.replace('_', ' ')}
          </span>
          <span className={`inline-block rounded px-2 py-0.5 text-xs ${FUL_BADGE[order.fulfillmentStatus]}`}>
            {order.fulfillmentStatus}
          </span>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {/* Line items */}
        <Card title={`Items (${order.lineItems.length})`}>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {order.lineItems.map((li) => (
              <li key={li.id} className="flex items-center gap-3 py-2 text-sm">
                <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0">
                  {li.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={li.imageUrl} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{li.productTitle}</div>
                  {li.variantTitle && <div className="text-xs text-[color:var(--color-text-muted)]">{li.variantTitle}</div>}
                  {li.sku && <div className="text-xs text-[color:var(--color-text-muted)]">SKU {li.sku}</div>}
                </div>
                <div className="text-right text-sm">
                  <div>{formatPrice(li.unitPriceCents, order.currency)} × {li.quantity}</div>
                  <div className="font-medium">{formatPrice(li.totalCents, order.currency)}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-[color:var(--color-border)] mt-3 pt-3 text-sm space-y-0.5">
            <Row label="Subtotal" val={formatPrice(order.subtotalCents, order.currency)} />
            {order.discountCents > 0 && <Row label="Discounts" val={`−${formatPrice(order.discountCents, order.currency)}`} />}
            <Row label="Shipping" val={formatPrice(order.shippingCents, order.currency)} />
            <Row label="VAT (included)" val={formatPrice(order.taxCents, order.currency)} muted />
            <Row label="Total" val={formatPrice(order.totalCents, order.currency)} bold />
            {order.totalRefundedCents > 0 && (
              <Row label="Refunded" val={`−${formatPrice(order.totalRefundedCents, order.currency)}`} />
            )}
          </div>
        </Card>

        {/* Payments */}
        <Card title={`Payments (${order.payments.length})`}>
          {order.payments.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No payments recorded.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)] text-sm">
              {order.payments.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium capitalize">{p.provider} · {p.status}</div>
                    {p.providerRef && <div className="text-xs text-[color:var(--color-text-muted)] font-mono">{p.providerRef}</div>}
                    <div className="text-xs text-[color:var(--color-text-muted)]">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="font-medium">{formatPrice(p.amountCents, p.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Timeline */}
        <Card title="Timeline">
          {order.events.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="text-[color:var(--color-text-muted)] text-xs shrink-0 mt-0.5 w-36">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span>
                    <span className="font-medium capitalize">{e.kind.replace('_', ' ')}</span>
                    {e.payload?.note !== undefined && (
                      <span className="text-[color:var(--color-text-muted)]"> — {String(e.payload.note)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <aside className="space-y-4 text-sm">
        <Card title="Customer">
          <div className="font-medium">{order.customerName || '—'}</div>
          <div className="text-[color:var(--color-text-muted)]">{order.email}</div>
          {order.phone && <div className="text-[color:var(--color-text-muted)]">{order.phone}</div>}
        </Card>

        {order.shippingAddress && (
          <Card title="Shipping address">
            <AddressBlock a={order.shippingAddress} />
          </Card>
        )}
        {order.billingAddress && (
          <Card title="Billing address">
            <AddressBlock a={order.billingAddress} />
          </Card>
        )}

        <Card title="Note">
          <NoteField initial={order.note} onSave={saveNote} busy={busy} />
        </Card>

        <Card title="Tags">
          <TagsField initial={order.tags} onSave={saveTags} busy={busy} />
        </Card>

        {order.status !== 'cancelled' && order.financialStatus !== 'paid' && (
          <button
            onClick={cancel}
            disabled={busy}
            className="w-full px-3 py-2 rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            Cancel order
          </button>
        )}
        {order.financialStatus === 'paid' && (
          <div className="text-xs text-[color:var(--color-text-muted)] italic">
            Paid orders must be refunded before cancelling (refunds land in Phase 3d).
          </div>
        )}
      </aside>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, val, muted, bold }: { label: string; val: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-medium' : ''} ${muted ? 'text-xs text-[color:var(--color-text-muted)]' : ''}`}>
      <span className={muted ? '' : 'text-[color:var(--color-text-muted)]'}>{label}</span>
      <span>{val}</span>
    </div>
  );
}

function AddressBlock({ a }: { a: NonNullable<Order['shippingAddress']> }) {
  return (
    <div className="text-sm space-y-0.5">
      <div>{a.firstName} {a.lastName}</div>
      {a.company && <div>{a.company}</div>}
      <div>{a.addressLine1}</div>
      {a.addressLine2 && <div>{a.addressLine2}</div>}
      <div>{a.postalCode} {a.city}</div>
      {a.region && <div>{a.region}</div>}
      <div>{a.country}</div>
      {a.phone && <div className="text-[color:var(--color-text-muted)]">{a.phone}</div>}
    </div>
  );
}

function NoteField({ initial, onSave, busy }: { initial: string; onSave: (v: string) => void; busy: boolean }) {
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const dirty = val !== initial;
  return (
    <div className="space-y-2">
      <textarea
        rows={3}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm"
      />
      <button
        onClick={() => onSave(val)}
        disabled={!dirty || busy}
        className="px-3 py-1 text-xs rounded border border-[color:var(--color-border)] disabled:opacity-50"
      >
        Save note
      </button>
    </div>
  );
}

function TagsField({ initial, onSave, busy }: { initial: string[]; onSave: (v: string) => void; busy: boolean }) {
  const initialStr = initial.join(', ');
  const [val, setVal] = useState(initialStr);
  useEffect(() => { setVal(initialStr); }, [initialStr]);
  const dirty = val !== initialStr;
  return (
    <div className="space-y-2">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="vip, gift, …"
        className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm"
      />
      <button
        onClick={() => onSave(val)}
        disabled={!dirty || busy}
        className="px-3 py-1 text-xs rounded border border-[color:var(--color-border)] disabled:opacity-50"
      >
        Save tags
      </button>
    </div>
  );
}
