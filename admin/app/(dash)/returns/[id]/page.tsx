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

  if (!ret) return <section><p className="text-stone-500">Loading…</p></section>;

  const STATUS_BADGE: Record<string, string> = {
    requested: 'badge-warning',
    approved: 'badge-info',
    rejected: 'badge-danger',
    received: 'badge-success',
    refunded: 'badge-success',
    cancelled: 'badge-neutral',
  };

  return (
    <section className="max-w-4xl">
      <div className="mb-5 flex items-center gap-3">
        <Link href="/returns" className="text-sm text-stone-500 hover:underline">← Returns</Link>
        <h1 className="h-page flex-1">{ret.rmaNumber}</h1>
        <span className={`badge ${STATUS_BADGE[ret.status] ?? 'badge-neutral'}`}>{ret.status}</span>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      <div className="card card-pad mb-4 text-sm">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <div className="label">Order</div>
            <Link href={`/orders/${ret.orderId}`} className="font-medium hover:underline">{ret.orderNumber}</Link>
          </div>
          <div>
            <div className="label">Requested by</div>
            <div className="font-medium capitalize">{ret.requestedBy}</div>
          </div>
          <div>
            <div className="label">Requested at</div>
            <div>{new Date(ret.requestedAt).toLocaleString()}</div>
          </div>
          <div>
            <div className="label">Estimated refund</div>
            <div className="font-medium tabular-nums">{formatPrice(ret.estimatedCents, ret.currency)}</div>
          </div>
        </div>
        {ret.customerNote && (
          <div className="border-t border-stone-200 pt-3 text-xs">
            <div className="label">Customer note</div>
            <div>{ret.customerNote}</div>
          </div>
        )}
      </div>

      <div className="card card-pad mb-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Items</h2>
        <div className="divide-y divide-stone-200/70 text-sm">
          {ret.items.map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-3">
              <div className="flex-1">
                <div className="font-medium">{l.productTitle}</div>
                {l.variantTitle && <div className="text-xs text-stone-500">{l.variantTitle}</div>}
                <div className="mt-0.5 text-xs text-stone-500">
                  Reason: {l.reason.replace(/_/g, ' ')}
                  {l.note && ` · ${l.note}`}
                  {l.restocked && <span className="ml-1 badge badge-success no-dot">restocked</span>}
                </div>
              </div>
              <div className="text-right">
                <div className="tabular-nums">{l.quantity} × {formatPrice(l.unitPriceCents, ret.currency)}</div>
                <div className="font-medium tabular-nums">{formatPrice(l.quantity * l.unitPriceCents, ret.currency)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="card card-pad flex flex-wrap gap-2">
        {ret.status === 'requested' && (
          <>
            <button disabled={busy} onClick={() => act('approve')} className="btn btn-primary">Approve</button>
            <button disabled={busy} onClick={() => act('reject')} className="btn btn-danger">Reject</button>
          </>
        )}
        {ret.status === 'approved' && (
          <button disabled={busy} onClick={() => setReceiveOpen(true)} className="btn btn-primary">
            Mark as received
          </button>
        )}
        {ret.status === 'received' && (
          <button disabled={busy} onClick={() => setRefundOpen(true)} className="btn btn-primary">
            Issue refund
          </button>
        )}
        {ret.status !== 'refunded' && ret.status !== 'cancelled' && (
          <button disabled={busy} onClick={() => act('cancel')} className="btn btn-secondary">
            Cancel return
          </button>
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
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">Mark as received</h2>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
          Restock items to inventory
        </label>
        {restock && (
          <label className="block">
            <span className="label">Restock to location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="select">
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={() => onReceive(restock, locationId)} disabled={busy || (restock && !locationId)} className="btn btn-primary">
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
  // Pre-fill with the smaller of estimated return value and what's still
  // refundable on the card — exceeding the card charge total would fail at Stripe.
  const maxRefundable = ret.remainingRefundableCents ?? ret.estimatedCents;
  const defaultCents = Math.min(ret.estimatedCents, maxRefundable);
  const [amountStr, setAmountStr] = useState((defaultCents / 100).toFixed(2));
  const [refundTo, setRefundTo] = useState<'card' | 'store_credit'>('card');
  const [note, setNote] = useState('');
  return (
    <div className="cp-backdrop fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="cp-panel w-full max-w-md rounded-2xl bg-white p-5 shadow-xl text-sm space-y-3">
        <h2 className="text-base font-semibold">Issue refund for return {ret.rmaNumber}</h2>
        <label className="block">
          <span className="label">Amount ({ret.currency})</span>
          <input type="number" step="0.01" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} className="input" />
          {ret.estimatedCents > maxRefundable && (
            <span className="help">
              Return value is {formatPrice(ret.estimatedCents, ret.currency)}, but only{' '}
              {formatPrice(maxRefundable, ret.currency)} is left refundable on the original charge
              (the rest was covered by store credit or already refunded).
            </span>
          )}
        </label>
        <label className="block">
          <span className="label">Refund to</span>
          <select value={refundTo} onChange={(e) => setRefundTo(e.target.value as 'card' | 'store_credit')} className="select">
            <option value="card">Original payment method (Stripe)</option>
            <option value="store_credit">Store credit</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => onRefund(Math.round(parseFloat(amountStr) * 100), refundTo, note)}
            disabled={busy}
            className="btn btn-primary"
          >
            {busy ? 'Refunding…' : 'Issue refund'}
          </button>
        </div>
      </div>
    </div>
  );
}
