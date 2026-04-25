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
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Customers</h1>
        {page && <span className="badge badge-neutral no-dot">{page.total} total</span>}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); load(search); }} className="mb-4">
        <input
          type="search"
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-80"
        />
      </form>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : page.items.length === 0 ? (
        <div className="empty">No customers yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Orders</th>
              <th>Spent</th>
              <th>Last order</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => {
              const name = `${c.firstName} ${c.lastName}`.trim();
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {name || c.email}
                    </Link>
                    {name && <div className="text-xs text-stone-500">{c.email}</div>}
                  </td>
                  <td className="tabular-nums">{c.orderCount}</td>
                  <td className="font-medium tabular-nums">{formatPrice(c.totalSpentCents, c.currency)}</td>
                  <td className="text-stone-500">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="badge badge-neutral no-dot">{t}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
