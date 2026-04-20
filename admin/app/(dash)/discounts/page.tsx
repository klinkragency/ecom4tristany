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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <Link href="/discounts/new" className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">
          + New discount
        </Link>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No discounts yet. Create one to run your first promo.
        </div>
      ) : (
        <table className="w-full text-sm border border-[color:var(--color-border)] rounded bg-white">
          <thead className="bg-gray-50 border-b border-[color:var(--color-border)]">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Used</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id} className="border-b border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/discounts/${d.id}`} className="hover:underline">{d.title}</Link>
                </td>
                <td className="px-3 py-2">
                  {d.code ? <span className="font-mono">{d.code}</span> : <span className="text-[color:var(--color-text-muted)]">— automatic —</span>}
                </td>
                <td className="px-3 py-2">{describe(d)}</td>
                <td className="px-3 py-2 text-xs text-[color:var(--color-text-muted)]">{d.scope}</td>
                <td className="px-3 py-2">{d.usageCount}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs rounded px-2 py-0.5 ${d.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
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
