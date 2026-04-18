'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type ProductListPage } from '@/lib/types';

export default function ProductsListPage() {
  const [page, setPage] = useState<ProductListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load(q = '') {
    try {
      const data = await api<ProductListPage>(
        `/api/admin/products?limit=25${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setPage(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    load();
  }, []);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <Link
          href="/products/new"
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
        >
          Add product
        </Link>
      </div>

      <form onSubmit={onSearch} className="mb-4">
        <input
          type="search"
          placeholder="Search title, handle, vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-80 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
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
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Variants</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {!page && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {page && page.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  No products yet.
                </td>
              </tr>
            )}
            {page?.items.map((p) => (
              <tr key={p.id} className="border-t border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <div className="text-xs text-[color:var(--color-text-muted)]">{p.handle}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={p.status} />
                </td>
                <td className="px-3 py-2">{p.variantCount}</td>
                <td className="px-3 py-2">
                  {p.minPriceCents === p.maxPriceCents
                    ? formatPrice(p.minPriceCents)
                    : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
                </td>
                <td className="px-3 py-2">{p.vendor || '—'}</td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                  {new Date(p.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const styles = {
    active: 'bg-green-100 text-green-800',
    draft: 'bg-gray-100 text-gray-800',
    archived: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
