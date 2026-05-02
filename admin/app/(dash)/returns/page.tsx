'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';
import { Select } from '@/components/ui';

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
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 md:flex-nowrap">
        <div className="w-44">
          <Select
            ariaLabel="Filter by status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'requested', label: 'Requested' },
              { value: 'approved', label: 'Approved' },
              { value: 'received', label: 'Received' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
          />
        </div>
        {filter && (
          <button
            type="button"
            onClick={() => setFilter('')}
            className="ml-auto text-sm text-stone-500 hover:text-stone-900"
          >
            Clear filters
          </button>
        )}
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
