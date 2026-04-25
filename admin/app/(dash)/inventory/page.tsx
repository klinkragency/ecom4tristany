'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Row = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  sku: string;
  imageUrl: string;
  onHand: number;
  committed: number;
  available: number;
  locationCount: number;
  track: boolean;
  low: boolean;
  out: boolean;
};

type Resp = {
  items: Row[];
  totalSkus: number;
  lowCount: number;
  outCount: number;
  threshold: number;
};

type Status = 'all' | 'low' | 'out';

export default function InventoryPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status>('all');

  async function load() {
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('q', search);
      if (status !== 'all') params.set('status', status);
      setData(await api<Resp>(`/api/admin/inventory?${params.toString()}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status]);

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Inventory</h1>
        {data && (
          <div className="flex items-center gap-2 text-xs">
            <span className="badge badge-neutral no-dot">{data.totalSkus} tracked SKUs</span>
            {data.lowCount > 0 && <span className="badge badge-warning">{data.lowCount} low</span>}
            {data.outCount > 0 && <span className="badge badge-danger">{data.outCount} out</span>}
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); load(); }}
          className="flex-1"
        >
          <input
            type="search"
            placeholder="Search title, SKU, handle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full max-w-sm"
          />
        </form>
        <div className="flex items-center gap-1 rounded-xl border bg-white p-1" style={{ borderColor: 'var(--color-border)' }}>
          {(['all', 'low', 'out'] as Status[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1 text-xs font-medium capitalize transition-colors ${
                status === s ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
              }`}
            >
              {s === 'all' ? 'All' : s === 'low' ? 'Low stock' : 'Out of stock'}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!data ? (
        <div className="empty">Loading…</div>
      ) : data.items.length === 0 ? (
        <div className="empty">No inventory matching this filter.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Product</th>
              <th>SKU</th>
              <th>Locations</th>
              <th className="text-right">On hand</th>
              <th className="text-right">Committed</th>
              <th className="text-right">Available</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => {
              const variantLabel = r.variantTitle ? ` — ${r.variantTitle}` : '';
              return (
                <tr key={r.variantId}>
                  <td>
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-stone-100">
                        {r.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-stone-400 text-xs">—</span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <Link href={`/products/${r.productId}`} className="font-medium hover:underline">
                          {r.productTitle}{variantLabel}
                        </Link>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.sku ? (
                      <span className="font-mono text-xs text-stone-600">{r.sku}</span>
                    ) : (
                      <span className="text-stone-400">—</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral no-dot">{r.locationCount} loc{r.locationCount === 1 ? '' : 's'}</span>
                  </td>
                  {r.track ? (
                    <>
                      <td className="text-right tabular-nums">{r.onHand}</td>
                      <td className="text-right tabular-nums text-stone-500">{r.committed}</td>
                      <td className="text-right">
                        <span className={`badge ${r.out ? 'badge-danger' : r.low ? 'badge-warning' : 'badge-success'}`}>
                          {r.available}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={3} className="text-right">
                      <span className="badge badge-neutral no-dot">Not tracked</span>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
