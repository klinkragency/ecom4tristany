'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type OrderListPage, type FinancialStatus, type FulfillmentStatus } from '@/lib/types';

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

export default function OrdersListPage() {
  const [page, setPage] = useState<OrderListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [finStatus, setFinStatus] = useState('');
  const [fulStatus, setFulStatus] = useState('');

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

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <span className="text-sm text-[color:var(--color-text-muted)]">
          {page ? `${page.total} total` : ''}
        </span>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); load({ q: search, fin: finStatus, ful: fulStatus }); }}
        className="flex flex-wrap gap-2 mb-4 items-center"
      >
        <input
          type="search"
          placeholder="Search by email or order #"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <select
          value={finStatus}
          onChange={(e) => setFinStatus(e.target.value)}
          className="px-3 py-2 rounded border border-[color:var(--color-border)] bg-white text-sm"
        >
          <option value="">All payments</option>
          <option value="pending">Pending</option>
          <option value="paid">Paid</option>
          <option value="refunded">Refunded</option>
          <option value="partially_refunded">Partially refunded</option>
        </select>
        <select
          value={fulStatus}
          onChange={(e) => setFulStatus(e.target.value)}
          className="px-3 py-2 rounded border border-[color:var(--color-border)] bg-white text-sm"
        >
          <option value="">All fulfillment</option>
          <option value="unfulfilled">Unfulfilled</option>
          <option value="partial">Partial</option>
          <option value="fulfilled">Fulfilled</option>
        </select>
      </form>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded border border-[color:var(--color-border)] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Payment</th>
              <th className="px-3 py-2 font-medium">Fulfillment</th>
              <th className="px-3 py-2 font-medium">Total</th>
              <th className="px-3 py-2 font-medium">Items</th>
            </tr>
          </thead>
          <tbody>
            {!page && <tr><td colSpan={7} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">Loading…</td></tr>}
            {page && page.items.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">No orders yet.</td></tr>
            )}
            {page?.items.map((o) => (
              <tr key={o.id} className="border-t border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.number}</Link>
                </td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                  {new Date(o.createdAt).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  <div>{o.customerName || '—'}</div>
                  <div className="text-xs text-[color:var(--color-text-muted)]">{o.email}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${FIN_BADGE[o.financialStatus]}`}>
                    {o.financialStatus.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${FUL_BADGE[o.fulfillmentStatus]}`}>
                    {o.fulfillmentStatus}
                  </span>
                </td>
                <td className="px-3 py-2 font-medium">{formatPrice(o.totalCents, o.currency)}</td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">{o.itemsCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
