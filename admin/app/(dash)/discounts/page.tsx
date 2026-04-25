'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Discount = {
  id: string;
  code?: string | null;
  title: string;
  kind: 'percentage' | 'amount' | 'free_shipping' | 'bogo';
  valuePercent?: number | null;
  valueCents?: number | null;
  scope: 'all' | 'products' | 'collections';
  eligibility: 'all' | 'segments';
  usageCount: number;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

function describe(d: Discount): string {
  switch (d.kind) {
    case 'percentage': return `${d.valuePercent ?? 0}% off`;
    case 'amount': return `${((d.valueCents ?? 0) / 100).toFixed(2)} € off`;
    case 'free_shipping': return 'Free shipping';
    case 'bogo': return 'Buy X Get Y';
  }
}

export default function DiscountsPage() {
  const [items, setItems] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ items: Discount[] }>('/api/admin/discounts');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  return (
    <section className="max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Discounts</h1>
        <Link href="/discounts/new" className="btn btn-primary">
          + New discount
        </Link>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No discounts yet. Create one to run your first promo.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Code</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Used</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td className="font-medium">
                  <Link href={`/discounts/${d.id}`} className="hover:underline">{d.title}</Link>
                </td>
                <td>
                  {d.code
                    ? <span className="font-mono text-xs">{d.code}</span>
                    : <span className="text-stone-400 italic">automatic</span>}
                </td>
                <td>{describe(d)}</td>
                <td className="text-stone-500 capitalize">{d.scope}</td>
                <td className="tabular-nums">{d.usageCount}</td>
                <td>
                  <span className={`badge ${d.active ? 'badge-success' : 'badge-neutral'}`}>
                    {d.active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
