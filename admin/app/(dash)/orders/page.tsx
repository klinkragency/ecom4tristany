'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import {
  formatPrice,
  type OrderListItem,
  type OrderListPage,
  type FinancialStatus,
  type FulfillmentStatus,
} from '@/lib/types';
import { ConfirmDialog, EntitySearchInput, RowActionsMenu, Select, type RowAction } from '@/components/ui';
import { AddNoteDialog } from './AddNoteDialog';

const FIN_BADGE: Record<FinancialStatus, string> = {
  pending: 'badge-neutral',
  authorized: 'badge-warning',
  paid: 'badge-success',
  partially_paid: 'badge-warning',
  refunded: 'badge-danger',
  partially_refunded: 'badge-danger',
  voided: 'badge-neutral',
};

const FUL_BADGE: Record<FulfillmentStatus, string> = {
  unfulfilled: 'badge-neutral',
  partial: 'badge-warning',
  fulfilled: 'badge-success',
  restocked: 'badge-neutral',
};

export default function OrdersListPage() {
  const router = useRouter();
  const [page, setPage] = useState<OrderListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [finStatus, setFinStatus] = useState('');
  const [fulStatus, setFulStatus] = useState('');
  const [noteFor, setNoteFor] = useState<OrderListItem | null>(null);
  const [cancelFor, setCancelFor] = useState<OrderListItem | null>(null);

  async function load(opts?: { q?: string; fin?: string; ful?: string }) {
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (opts?.q) params.set('q', opts.q);
      if (opts?.fin) params.set('financialStatus', opts.fin);
      if (opts?.ful) params.set('fulfillmentStatus', opts.ful);
      setPage(await api<OrderListPage>(`/api/admin/orders?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load({ q: search, fin: finStatus, ful: fulStatus }); }, [finStatus, fulStatus]);

  async function confirmCancel() {
    if (!cancelFor) return;
    await api(`/api/admin/orders/${cancelFor.id}/cancel`, { method: 'POST' });
    setCancelFor(null);
    await load({ q: search, fin: finStatus, ful: fulStatus });
  }

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Orders</h1>
        {page && <span className="badge badge-neutral no-dot">{page.total} total</span>}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); load({ q: search, fin: finStatus, ful: fulStatus }); }}
        className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap"
      >
        <div className="min-w-0 flex-1">
          <EntitySearchInput
            kinds={['order']}
            placeholder="Search by email or order #…"
          />
        </div>
        <div className="w-44">
          <Select
            ariaLabel="Filter by payment status"
            value={finStatus}
            onChange={setFinStatus}
            options={[
              { value: '', label: 'All payments' },
              { value: 'pending', label: 'Pending' },
              { value: 'paid', label: 'Paid' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'partially_refunded', label: 'Partially refunded' },
            ]}
          />
        </div>
        <div className="w-44">
          <Select
            ariaLabel="Filter by fulfillment status"
            value={fulStatus}
            onChange={setFulStatus}
            options={[
              { value: '', label: 'All fulfillment' },
              { value: 'unfulfilled', label: 'Unfulfilled' },
              { value: 'partial', label: 'Partial' },
              { value: 'fulfilled', label: 'Fulfilled' },
            ]}
          />
        </div>
        {(search || finStatus || fulStatus) && (
          <button
            type="button"
            onClick={() => { setSearch(''); setFinStatus(''); setFulStatus(''); }}
            className="ml-auto text-sm text-stone-500 hover:text-stone-900"
          >
            Clear filters
          </button>
        )}
      </form>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : page.items.length === 0 ? (
        <div className="empty">No orders yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Payment</th>
              <th>Fulfillment</th>
              <th>Total</th>
              <th>Items</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((o) => {
              // Spec: hide cancel when already cancelled or already fulfilled.
              // FinancialStatus has no 'cancelled' variant — order-level status carries that.
              const cancellable =
                o.status !== 'cancelled' &&
                o.fulfillmentStatus !== 'fulfilled';
              const actions: RowAction[] = [
                {
                  label: 'View',
                  onClick: () => router.push(`/orders/${o.id}`),
                },
                {
                  label: 'Add note',
                  onClick: () => setNoteFor(o),
                },
              ];
              if (cancellable) {
                actions.push({
                  label: 'Cancel order',
                  destructive: true,
                  onClick: () => setCancelFor(o),
                });
              }
              return (
                <tr key={o.id}>
                  <td>
                    <Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.number}</Link>
                  </td>
                  <td className="text-stone-500">{new Date(o.createdAt).toLocaleString()}</td>
                  <td>
                    <div>{o.customerName || '—'}</div>
                    <div className="text-xs text-stone-500">{o.email}</div>
                  </td>
                  <td>
                    <span className={`badge ${FIN_BADGE[o.financialStatus]}`}>
                      {o.financialStatus.replace('_', ' ')}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${FUL_BADGE[o.fulfillmentStatus]}`}>
                      {o.fulfillmentStatus}
                    </span>
                  </td>
                  <td className="font-medium tabular-nums">{formatPrice(o.totalCents, o.currency)}</td>
                  <td className="text-stone-500 tabular-nums">{o.itemsCount}</td>
                  <td>
                    <RowActionsMenu label={`Actions for ${o.number}`} actions={actions} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {noteFor && (
        <AddNoteDialog
          open
          orderId={noteFor.id}
          orderNumber={noteFor.number}
          onClose={() => setNoteFor(null)}
          onDone={async () => {
            setNoteFor(null);
            await load({ q: search, fin: finStatus, ful: fulStatus });
          }}
        />
      )}

      <ConfirmDialog
        open={cancelFor !== null}
        title="Cancel order?"
        description="The order moves to cancelled status. Stock that was committed will be released."
        confirmLabel="Cancel order"
        destructive
        onCancel={() => setCancelFor(null)}
        onConfirm={confirmCancel}
      />
    </section>
  );
}
