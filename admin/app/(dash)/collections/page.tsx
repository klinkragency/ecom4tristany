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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <Link
          href="/collections/new"
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
        >
          New collection
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(search);
        }}
        className="mb-4"
      >
        <input
          type="search"
          placeholder="Search by title or handle…"
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
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Products</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {!page && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {page && page.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  No collections yet.
                </td>
              </tr>
            )}
            {page?.items.map((c) => (
              <tr key={c.id} className="border-t border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/collections/${c.id}`} className="font-medium hover:underline">
                    {c.title}
                  </Link>
                  <div className="text-xs text-[color:var(--color-text-muted)]">{c.handle}</div>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-xs ${
                      c.isRulesBased ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {c.isRulesBased ? 'Rule-based' : 'Manual'}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {c.isRulesBased ? (
                    <span className="text-[color:var(--color-text-muted)]">auto</span>
                  ) : (
                    c.productCount
                  )}
                </td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
