'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { CollectionListPage } from '@/lib/types';

export default function CollectionsListPage() {
  const [page, setPage] = useState<CollectionListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  async function load(q = '') {
    try {
      const data = await api<CollectionListPage>(
        `/api/admin/collections?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setPage(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Collections</h1>
        <Link href="/collections/new" className="btn btn-primary">
          New collection
        </Link>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); load(search); }} className="mb-4">
        <input
          type="search"
          placeholder="Search by title or handle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-80"
        />
      </form>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : page.items.length === 0 ? (
        <div className="empty">No collections yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Products</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/collections/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  <div className="text-xs text-stone-500">{c.handle}</div>
                </td>
                <td>
                  <span className={`badge ${c.isRulesBased ? 'badge-info' : 'badge-neutral'}`}>
                    {c.isRulesBased ? 'Rule-based' : 'Manual'}
                  </span>
                </td>
                <td className="tabular-nums">
                  {c.isRulesBased ? <span className="text-stone-400">auto</span> : c.productCount}
                </td>
                <td className="text-stone-500">{new Date(c.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
