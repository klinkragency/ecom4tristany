'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type CustomerListPage } from '@/lib/types';

export default function CustomersListPage() {
  const [page, setPage] = useState<CustomerListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load(q = '') {
    try {
      const res = await api<CustomerListPage>(
        `/api/admin/customers?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setPage(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <span className="text-sm text-[color:var(--color-text-muted)]">
          {page ? `${page.total} total` : ''}
        </span>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); load(search); }}
        className="mb-4"
      >
        <input
          type="search"
          placeholder="Search by email or name…"
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
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Orders</th>
              <th className="px-3 py-2 font-medium">Spent</th>
              <th className="px-3 py-2 font-medium">Last order</th>
              <th className="px-3 py-2 font-medium">Tags</th>
            </tr>
          </thead>
          <tbody>
            {!page && <tr><td colSpan={5} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">Loading…</td></tr>}
            {page && page.items.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">No customers yet.</td></tr>
            )}
            {page?.items.map((c) => {
              const name = `${c.firstName} ${c.lastName}`.trim();
              return (
                <tr key={c.id} className="border-t border-[color:var(--color-border)] hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {name || c.email}
                    </Link>
                    {name && <div className="text-xs text-[color:var(--color-text-muted)]">{c.email}</div>}
                  </td>
                  <td className="px-3 py-2">{c.orderCount}</td>
                  <td className="px-3 py-2 font-medium">{formatPrice(c.totalSpentCents, c.currency)}</td>
                  <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="text-xs rounded bg-gray-100 px-2 py-0.5">{t}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
