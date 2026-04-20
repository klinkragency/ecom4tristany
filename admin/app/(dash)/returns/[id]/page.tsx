'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';

type Line = {
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

type ReturnDetail = {
  id: string;
  orderId: string;
  orderNumber: string;
  rmaNumber: string;
  status: string;
  customerNote: string;
  adminNote: string;
  requestedBy: string;
  requestedAt: string;
  approvedAt?: string | null;
  receivedAt?: string | null;
  refundedAt?: string | null;
  items: Line[];
  currency: string;
  estimatedCents: number;
  remainingRefundableCents: number;
};

type LocationOption = { id: string; name: string };

export default function ReturnDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [ret, setRet] = useState<ReturnDetail | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);

  async function load() {
    try {
      const [r, l] = await Promise.all([
        api<ReturnDetail>(`/api/admin/returns/${id}`),
        api<LocationOption[]>('/api/admin/locations').catch(() => []),
      ]);
      setRet(r);
      setLocations(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [id]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/returns/${id}/${path}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  if (!ret) return <section><p className="text-[color:var(--color-text-muted)]">Loading…</p></section>;

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/returns" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Returns</Link>
        <h1 className="text-2xl font-semibold flex-1">{ret.rmaNumber}</h1>
        <span className="text-xs rounded px-2 py-0.5 bg-gray-100 text-gray-800">{ret.status}</span>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4 text-sm">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Order</div>
            <Link href={`/orders/${ret.orderId}`} className="font-medium hover:underline">{ret.orderNumber}</Link>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Requested by</div>
            <div className="font-medium capitalize">{ret.requestedBy}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Requested at</div>
            <div>{new Date(ret.requestedAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-[color:var(--color-text-muted)]">Estimated refund</div>
            <div className="font-medium">{formatPrice(ret.estimatedCents, ret.currency)}</div>
          </div>
        </div>
        {ret.customerNote && (
          <div className="border-t border-[color:var(--color-border)] pt-2 text-xs">
            <div className="font-semibold text-[color:var(--color-text-muted)] mb-1">Customer note</div>
            <div>{ret.customerNote}</div>
          </div>
        )}
      </div>

      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4">
        <h2 className="text-sm font-semibold mb-2">Items</h2>
        <ul className="divide-y divide-[color:var(--color-border)] text-sm">
          {ret.items.map((l) => (
            <li key={l.id} className="py-2 flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium">{l.productTitle}</div>
                {l.variantTitle && <div className="text-xs text-[color:var(--color-text-muted)]">{l.variantTitle}</div>}
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  Reason: {l.reason.replace(/_/g, ' ')}
                  {l.note && ` · ${l.note}`}
                  {l.restocked && ' · restocked'}
                </div>
              </div>
              <div className="text-right">
                <div>{l.quantity} × {formatPrice(l.unitPriceCents, ret.currency)}</div>
                <div className="font-medium">{formatPrice(l.quantity * l.unitPriceCents, ret.currency)}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 flex flex-wrap gap-2">
        {ret.status === 'requested' && (
          <>
            <button disabled={busy} onClick={() => act('approve')}
              className="px-3 py-2 text-sm rounded bg-blue-700 text-white disabled:opacity-50">Approve</button>
            <button disabled={busy} onClick={() => act('reject')}
              className="px-3 py-2 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50">Reject</button>
          </>
        )}
        {ret.status === 'approved' && (
          <button disabled={busy} onClick={() => setReceiveOpen(true)}
            className="px-3 py-2 text-sm rounded bg-emerald-700 text-white disabled:opacity-50">Mark as received</button>
        )}
        {ret.status === 'received' && (
          <button disabled={busy} onClick={() => setRefundOpen(true)}
            className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">Issue refund</button>
        )}
        {ret.status !== 'refunded' && ret.status !== 'cancelled' && (
          <button disabled={busy} onClick={() => act('cancel')}
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)] disabled:opacity-50">Cancel return</button>
        )}
      </div>

      {receiveOpen && (
        <ReceiveModal
          locations={locations}
          busy={busy}
          onClose={() => setReceiveOpen(false)}
          onReceive={async (restock, locationId) => {
            await act('receive', { restock, locationId });
            setReceiveOpen(false);
          }}
        />
      )}
      {refundOpen && (
        <RefundModal
          ret={ret}
          busy={busy}
          onClose={() => setRefundOpen(false)}
          onRefund={async (amountCents, refundTo, note) => {
            await act('refund', { amountCents, refundTo, note });
            setRefundOpen(false);
          }}
        />
      )}
    </section>
  );
}

function ReceiveModal({
  locations, busy, onClose, onReceive,
}: {
  locations: LocationOption[];
  busy: boolean;
  onClose: () => void;
  onReceive: (restock: boolean, locationId: string) => Promise<void>;
}) {
  const [restock, setRestock] = useState(true);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Mark as received</h2>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Restock items to inventory
        </label>
        {restock && (
          <label className="block">
            <div className="font-medium mb-1">Restock to location</div>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={() => onReceive(restock, locationId)} disabled={busy || (restock && !locationId)}
            className="px-3 py-2 rounded bg-emerald-700 text-white disabled:opacity-50">
            {busy ? 'Saving…' : 'Mark received'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({
  ret, busy, onClose, onRefund,
}: {
  ret: ReturnDetail;
  busy: boolean;
  onClose: () => void;
  onRefund: (amountCents: number, refundTo: string, note: string) => Promise<void>;
}) {
  const [amountStr, setAmountStr] = useState((ret.estimatedCents / 100).toFixed(2));
  const [refundTo, setRefundTo] = useState<'card' | 'store_credit'>('card');
  const [note, setNote] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Issue refund for return {ret.rmaNumber}</h2>
        <label className="block">
          <div className="font-medium mb-1">Amount ({ret.currency})</div>
          <input type="number" step="0.01" value={amountStr} onChange={(e) => setAmountStr(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Refund to</div>
          <select value={refundTo} onChange={(e) => setRefundTo(e.target.value as 'card' | 'store_credit')}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white">
            <option value="card">Original payment method (Stripe)</option>
            <option value="store_credit">Store credit</option>
          </select>
        </label>
        <label className="block">
          <div className="font-medium mb-1">Note (optional)</div>
          <input value={note} onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button
            onClick={() => onRefund(Math.round(parseFloat(amountStr) * 100), refundTo, note)}
            disabled={busy}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50"
          >
            {busy ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
