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
  requested: 'badge-warning',
  approved: 'badge-info',
  rejected: 'badge-danger',
  received: 'badge-success',
  refunded: 'badge-success',
  cancelled: 'badge-neutral',
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
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Returns</h1>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="select w-auto">
          <option value="">All statuses</option>
          <option value="requested">Requested</option>
          <option value="approved">Approved</option>
          <option value="received">Received</option>
          <option value="refunded">Refunded</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No returns{filter ? ` in status "${filter}"` : ''} yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>RMA</th>
              <th>Order</th>
              <th>Status</th>
              <th>Items</th>
              <th className="text-right">Estimated</th>
              <th>Requested</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  <Link href={`/returns/${r.id}`} className="hover:underline">{r.rmaNumber}</Link>
                </td>
                <td>
                  <Link href={`/orders/${r.orderId}`} className="hover:underline">{r.orderNumber}</Link>
                </td>
                <td>
                  <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge-neutral'}`}>{r.status}</span>
                </td>
                <td className="text-xs text-stone-500 tabular-nums">
                  {r.items.length} line{r.items.length === 1 ? '' : 's'}
                </td>
                <td className="text-right tabular-nums font-medium">{formatPrice(r.estimatedCents, r.currency)}</td>
                <td className="text-xs text-stone-500">{new Date(r.requestedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
