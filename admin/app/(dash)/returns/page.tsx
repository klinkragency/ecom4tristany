'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';

type ReturnRow = {
  id: string;
  orderId: string;
  orderNumber: string;
  rmaNumber: string;
  status: string;
  customerNote: string;
  requestedAt: string;
  items: { productTitle: string; quantity: number }[];
  currency: string;
  estimatedCents: number;
};

const STATUS_BADGE: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  received: 'bg-emerald-100 text-emerald-800',
  refunded: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export default function ReturnsListPage() {
  const [items, setItems] = useState<ReturnRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  async function load() {
    try {
      const qs = filter ? `?status=${filter}` : '';
      const data = await api<{ items: ReturnRow[] }>(`/api/admin/returns${qs}`);
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [filter]);

  return (
    <section className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Returns</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)] bg-white"
        >
          <option value="">All statuses</option>
          <option value="requested">Requested</option>
          <option value="approved">Approved</option>
          <option value="received">Received</option>
          <option value="refunded">Refunded</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No returns{filter ? ` in status "${filter}"` : ''} yet.
        </div>
      ) : (
        <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
          <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">RMA</th>
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Items</th>
              <th className="px-3 py-2 font-medium text-right">Estimated</th>
              <th className="px-3 py-2 font-medium">Requested</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/returns/${r.id}`} className="hover:underline">{r.rmaNumber}</Link>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/orders/${r.orderId}`} className="hover:underline">{r.orderNumber}</Link>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-xs rounded px-2 py-0.5 ${STATUS_BADGE[r.status] ?? 'bg-gray-100 text-gray-800'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                  {r.items.length} line{r.items.length === 1 ? '' : 's'}
                </td>
                <td className="px-3 py-2 text-right">{formatPrice(r.estimatedCents, r.currency)}</td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">
                  {new Date(r.requestedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
