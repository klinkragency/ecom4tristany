'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Card, ConfirmDialog } from '@/components/ui';

type OrderPending =
  | { kind: 'cancelOrder' }
  | { kind: 'cancelFulfillment'; fulfillmentId: string }
  | null;
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

type LocationOption = { id: string; name: string };
type Fulfillment = {
  id: string;
  number: number;
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  status: string;
  shippedAt: string | null;
  createdAt: string;
  locationName: string;
  items: { id: string; orderLineItemId: string; productTitle: string; variantTitle: string; sku: string; quantity: number }[];
};
type ReturnLine = {
  id: string;
  orderLineItemId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  reason: string;
  note: string;
  restocked: boolean;
};
type ReturnRow = {
  id: string;
  rmaNumber: string;
  status: string;
  customerNote: string;
  adminNote: string;
  requestedAt: string;
  items: ReturnLine[];
  currency: string;
  estimatedCents: number;
};

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([]);
  const [returnsList, setReturnsList] = useState<ReturnRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [pending, setPending] = useState<OrderPending>(null);

  async function load() {
    try {
      const [o, f, ret] = await Promise.all([
        api<Order>(`/api/admin/orders/${id}`),
        api<{ items: Fulfillment[] }>(`/api/admin/orders/${id}/fulfillments`),
        api<{ items: ReturnRow[] }>(`/api/admin/returns?orderId=${id}`).catch(() => ({ items: [] })),
      ]);
      setOrder(o);
      setFulfillments(f.items ?? []);
      setReturnsList((ret.items ?? []).filter((r) => r !== null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  async function loadLocations() {
    try {
      const list = await api<LocationOption[]>('/api/admin/locations');
      setLocations(list);
    } catch { /* ignore */ }
  }

  useEffect(() => { load(); loadLocations(); }, [id]);


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
        <p className="text-stone-500">Loading…</p>
        {error && <div className="mt-3 text-red-700 text-sm">{error}</div>}
      </section>
    );
  }

  return (
    <section className="max-w-5xl grid md:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="mb-5 flex items-center gap-3">
          <Link href="/orders" className="text-sm text-stone-500 hover:underline">← Orders</Link>
          <h1 className="h-page">{order.number}</h1>
          <span className={`badge ${FIN_BADGE[order.financialStatus]}`}>
            {order.financialStatus.replace('_', ' ')}
          </span>
          <span className={`badge ${FUL_BADGE[order.fulfillmentStatus]}`}>
            {order.fulfillmentStatus}
          </span>
        </div>

        {error && <div className="alert alert-error mb-4">{error}</div>}

        {/* Line items */}
        <Card title={`Items (${order.lineItems.length})`} className="mb-4 space-y-2">
          <ul className="divide-y divide-stone-200">
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
                  {li.variantTitle && <div className="text-xs text-stone-500">{li.variantTitle}</div>}
                  {li.sku && <div className="text-xs text-stone-500">SKU {li.sku}</div>}
                </div>
                <div className="text-right text-sm">
                  <div>{formatPrice(li.unitPriceCents, order.currency)} × {li.quantity}</div>
                  <div className="font-medium">{formatPrice(li.totalCents, order.currency)}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-stone-200 mt-3 pt-3 text-sm space-y-0.5">
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
        <Card title={`Payments (${order.payments.length})`} className="mb-4 space-y-2">
          {order.payments.length === 0 ? (
            <p className="text-sm text-stone-500">No payments recorded.</p>
          ) : (
            <ul className="divide-y divide-stone-200 text-sm">
              {order.payments.map((p) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <div>
                    <div className="font-medium capitalize">{p.provider} · {p.status}</div>
                    {p.providerRef && <div className="text-xs text-stone-500 font-mono">{p.providerRef}</div>}
                    <div className="text-xs text-stone-500">
                      {new Date(p.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="font-medium">{formatPrice(p.amountCents, p.currency)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Fulfillments */}
        <Card title={`Fulfillments (${fulfillments.length})`} className="mb-4 space-y-2">
          {fulfillments.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing shipped yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {fulfillments.map((f) => (
                <li key={f.id} className="rounded-xl border border-stone-200 p-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-medium">#{f.number}</span>
                    <span className={`badge ${f.status === 'cancelled' ? 'badge-danger' : 'badge-success'}`}>{f.status}</span>
                    {f.carrier && <span className="text-xs text-stone-500">via {f.carrier}</span>}
                    {f.trackingNumber && (
                      <span className="font-mono text-xs text-stone-500">
                        {f.trackingUrl ? <a href={f.trackingUrl} target="_blank" rel="noreferrer" className="underline">{f.trackingNumber}</a> : f.trackingNumber}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-stone-500">
                      {f.shippedAt ? new Date(f.shippedAt).toLocaleString() : new Date(f.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <ul className="text-xs text-stone-500">
                    {f.items.map((it) => (
                      <li key={it.id}>
                        {it.quantity} × {it.productTitle}{it.variantTitle && ` — ${it.variantTitle}`}
                      </li>
                    ))}
                  </ul>
                  {f.status !== 'cancelled' && (
                    <button
                      onClick={() => setPending({ kind: 'cancelFulfillment', fulfillmentId: f.id })}
                      className="btn btn-danger btn-sm mt-2"
                    >
                      Cancel fulfillment
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {order.fulfillmentStatus !== 'fulfilled' && order.status !== 'cancelled' && order.financialStatus === 'paid' && (
            <button
              onClick={() => setFulfillOpen(true)}
              className="btn btn-secondary btn-sm mt-3"
            >
              + Fulfill items
            </button>
          )}
        </Card>

        {/* Returns */}
        {returnsList.length > 0 && (
          <Card title={`Returns (${returnsList.length})`} className="mb-4 space-y-2">
            <ul className="space-y-2 text-sm">
              {returnsList.map((r) => (
                <li key={r.id} className="flex items-center gap-2 rounded-xl border border-stone-200 p-2.5">
                  <Link href={`/returns/${r.id}`} className="font-medium hover:underline">{r.rmaNumber}</Link>
                  <span className="badge badge-neutral no-dot">{r.status}</span>
                  <span className="flex-1 text-xs text-stone-500">
                    {r.items.length} line{r.items.length === 1 ? '' : 's'} · {formatPrice(r.estimatedCents, r.currency)}
                  </span>
                  <span className="text-xs text-stone-500">
                    {new Date(r.requestedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Timeline */}
        <Card title="Timeline" className="mb-4 space-y-2">
          {order.events.length === 0 ? (
            <p className="text-sm text-stone-500">No events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {order.events.map((e) => (
                <li key={e.id} className="flex items-start gap-2">
                  <span className="text-stone-500 text-xs shrink-0 mt-0.5 w-36">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span>
                    <span className="font-medium capitalize">{e.kind.replace('_', ' ')}</span>
                    {e.payload?.note !== undefined && (
                      <span className="text-stone-500"> — {String(e.payload.note)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <aside className="space-y-4 text-sm">
        <Card title="Customer" className="mb-4 space-y-2">
          <div className="font-medium">{order.customerName || '—'}</div>
          <div className="text-stone-500">{order.email}</div>
          {order.phone && <div className="text-stone-500">{order.phone}</div>}
        </Card>

        {order.shippingAddress && (
          <Card title="Shipping address" className="mb-4 space-y-2">
            <AddressBlock a={order.shippingAddress} />
          </Card>
        )}
        {order.billingAddress && (
          <Card title="Billing address" className="mb-4 space-y-2">
            <AddressBlock a={order.billingAddress} />
          </Card>
        )}

        <Card title="Note" className="mb-4 space-y-2">
          <NoteField initial={order.note} onSave={saveNote} busy={busy} />
        </Card>

        <Card title="Tags" className="mb-4 space-y-2">
          <TagsField initial={order.tags} onSave={saveTags} busy={busy} />
        </Card>

        {order.status !== 'cancelled' && order.financialStatus !== 'paid' && order.financialStatus !== 'partially_refunded' && order.financialStatus !== 'refunded' && (
          <button onClick={() => setPending({ kind: 'cancelOrder' })} disabled={busy} className="btn btn-danger w-full">
            Cancel order
          </button>
        )}

        {(order.financialStatus === 'paid' || order.financialStatus === 'partially_refunded') && (
          <button
            onClick={() => setRefundOpen(true)}
            disabled={busy || order.totalRefundedCents >= order.totalCents}
            className="btn btn-secondary w-full"
          >
            Issue refund
          </button>
        )}
      </aside>

      {refundOpen && (
        <RefundModal
          order={order}
          onClose={() => setRefundOpen(false)}
          onDone={async () => { setRefundOpen(false); await load(); }}
        />
      )}
      {fulfillOpen && (
        <FulfillModal
          order={order}
          locations={locations}
          fulfillments={fulfillments}
          onClose={() => setFulfillOpen(false)}
          onDone={async () => { setFulfillOpen(false); await load(); }}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.kind === 'cancelOrder' ? 'Cancel order?' : pending?.kind === 'cancelFulfillment' ? 'Cancel fulfillment?' : ''}
        description={
          pending?.kind === 'cancelOrder'
            ? 'The order moves to cancelled status. Stock that was committed will be released.'
            : pending?.kind === 'cancelFulfillment'
            ? 'The items go back to inventory.'
            : undefined
        }
        confirmLabel={pending?.kind === 'cancelOrder' ? 'Cancel order' : pending?.kind === 'cancelFulfillment' ? 'Cancel & restock' : 'Confirm'}
        cancelLabel={pending?.kind === 'cancelOrder' ? 'Keep open' : pending?.kind === 'cancelFulfillment' ? 'Keep' : 'Cancel'}
        destructive
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          if (!pending) return;
          if (pending.kind === 'cancelOrder') {
            await api(`/api/admin/orders/${id}/cancel`, { method: 'POST' });
          } else if (pending.kind === 'cancelFulfillment') {
            await api(`/api/admin/fulfillments/${pending.fulfillmentId}/cancel`, { method: 'POST' });
          }
          setPending(null);
          await load();
        }}
      />
    </section>
  );
}

function FulfillModal({
  order, locations, fulfillments, onClose, onDone,
}: {
  order: Order;
  locations: LocationOption[];
  fulfillments: Fulfillment[];
  onClose: () => void;
  onDone: () => void;
}) {
  // For each order line, compute how much is left to fulfill.
  const alreadyByLine = new Map<string, number>();
  for (const f of fulfillments) {
    if (f.status === 'cancelled') continue;
    for (const it of f.items) {
      alreadyByLine.set(it.orderLineItemId, (alreadyByLine.get(it.orderLineItemId) ?? 0) + it.quantity);
    }
  }
  const fulfillable = order.lineItems.map((li) => ({
    id: li.id,
    title: li.productTitle + (li.variantTitle ? ` — ${li.variantTitle}` : ''),
    sku: li.sku,
    remaining: Math.max(0, li.quantity - (alreadyByLine.get(li.id) ?? 0)),
  }));

  const [qtyByLine, setQtyByLine] = useState<Record<string, number>>(
    Object.fromEntries(fulfillable.map((l) => [l.id, l.remaining])),
  );
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [carrier, setCarrier] = useState('Colissimo');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const items = Object.entries(qtyByLine)
      .filter(([, q]) => q > 0)
      .map(([orderLineItemId, q]) => ({ orderLineItemId, quantity: q }));
    if (items.length === 0) {
      setError('Select at least one item to fulfill.');
      setSubmitting(false);
      return;
    }
    try {
      await api(`/api/admin/orders/${order.id}/fulfillments`, {
        method: 'POST',
        body: JSON.stringify({
          locationId, carrier, trackingNumber, trackingUrl, notifyCustomer: notify, items,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Fulfill failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-xl rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">Fulfill items</h2>
        {error && <div className="alert alert-error text-xs">{error}</div>}

        <div className="divide-y divide-stone-200/70 rounded-xl border border-stone-200">
          {fulfillable.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1">
                <div className="font-medium">{l.title}</div>
                {l.sku && <div className="text-xs text-stone-500">SKU {l.sku}</div>}
                <div className="text-xs text-stone-500">Remaining: {l.remaining}</div>
              </div>
              <input
                type="number"
                min={0}
                max={l.remaining}
                value={qtyByLine[l.id] ?? 0}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(l.remaining, Number(e.target.value)));
                  setQtyByLine((s) => ({ ...s, [l.id]: v }));
                }}
                disabled={l.remaining === 0}
                className="input w-20"
              />
            </div>
          ))}
        </div>

        <label className="block">
          <span className="label">Ship from</span>
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="select">
            <option value="">— No location (inventory not decremented) —</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Carrier</span>
            <input value={carrier} onChange={(e) => setCarrier(e.target.value)} list="carriers" className="input" />
            <datalist id="carriers">
              <option value="Colissimo" />
              <option value="La Poste" />
              <option value="DHL" />
              <option value="UPS" />
              <option value="FedEx" />
              <option value="Chronopost" />
              <option value="Mondial Relay" />
            </datalist>
          </label>
          <label className="block">
            <span className="label">Tracking number</span>
            <input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="input font-mono"
            />
          </label>
        </div>
        <label className="block">
          <span className="label">Tracking URL (optional)</span>
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            placeholder="https://www.laposte.fr/outils/suivre-vos-envois?code=..."
            className="input"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Email the customer a shipping notification
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={submitting} className="btn btn-primary">
            {submitting ? 'Shipping…' : 'Ship items'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({
  order,
  onClose,
  onDone,
}: {
  order: Order;
  onClose: () => void;
  onDone: () => void;
}) {
  const refundable = order.totalCents - order.totalRefundedCents;
  const [amountStr, setAmountStr] = useState((refundable / 100).toFixed(2));
  const [reason, setReason] = useState<'' | 'duplicate' | 'fraudulent' | 'requested_by_customer'>('requested_by_customer');
  const [note, setNote] = useState('');
  const [refundTo, setRefundTo] = useState<'card' | 'store_credit'>('card');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRefundToCredit = !!order.customerId;

  async function submit() {
    setSubmitting(true);
    setError(null);
    const amountCents = Math.round(parseFloat(amountStr) * 100);
    if (!amountCents || amountCents <= 0 || amountCents > refundable) {
      setError(`Enter an amount between 0.01 and ${(refundable / 100).toFixed(2)}`);
      setSubmitting(false);
      return;
    }
    try {
      await api(`/api/admin/orders/${order.id}/refunds`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents,
          reason: note,
          note,
          refundTo,
          stripeReason: refundTo === 'card' ? (reason || undefined) : undefined,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Refund failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">Issue refund</h2>
        <p className="text-stone-500">
          Refundable: {formatPrice(refundable, order.currency)} of {formatPrice(order.totalCents, order.currency)}
        </p>

        {error && (
          <div className="alert alert-error text-xs">{error}</div>
        )}

        <div className="block">
          <span className="label">Refund to</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRefundTo('card')}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors ${refundTo === "card" ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white hover:bg-stone-50"}`}
            >
              Original payment method
            </button>
            <button
              type="button"
              disabled={!canRefundToCredit}
              onClick={() => setRefundTo('store_credit')}
              title={canRefundToCredit ? 'Add back to the customer\u2019s store credit' : 'Guest order — no customer account'}
              className={`rounded-lg border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                refundTo === 'store_credit'
                  ? 'border-stone-900 bg-stone-900 text-white'
                  : 'border-stone-200 bg-white hover:bg-stone-50'
              }`}
            >
              Store credit
            </button>
          </div>
          {refundTo === 'store_credit' && (
            <span className="help">No Stripe refund fee — money is added to the customer&rsquo;s balance.</span>
          )}
        </div>

        <label className="block">
          <span className="label">Amount ({order.currency})</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            max={(refundable / 100).toFixed(2)}
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            className="input"
          />
        </label>

        {refundTo === 'card' && (
          <label className="block">
            <span className="label">Reason (Stripe)</span>
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="select">
              <option value="requested_by_customer">Requested by customer</option>
              <option value="duplicate">Duplicate</option>
              <option value="fraudulent">Fraudulent</option>
              <option value="">Unspecified</option>
            </select>
          </label>
        )}

        <label className="block">
          <span className="label">Internal note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Damaged on arrival…" className="input" />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={submit} disabled={submitting} className="btn btn-primary">
            {submitting ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, val, muted, bold }: { label: string; val: string; muted?: boolean; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-medium' : ''} ${muted ? 'text-xs text-stone-500' : ''}`}>
      <span className={muted ? '' : 'text-stone-500'}>{label}</span>
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
      {a.phone && <div className="text-stone-500">{a.phone}</div>}
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
        className="textarea text-sm"
      />
      <button
        onClick={() => onSave(val)}
        disabled={!dirty || busy}
        className="btn btn-secondary btn-sm"
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
        className="input"
      />
      <button
        onClick={() => onSave(val)}
        disabled={!dirty || busy}
        className="btn btn-secondary btn-sm"
      >
        Save tags
      </button>
    </div>
  );
}
