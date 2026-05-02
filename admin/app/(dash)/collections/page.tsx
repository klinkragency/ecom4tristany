'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { CollectionListItem, CollectionListPage } from '@/lib/types';
import { CreateCollectionButton } from './CreateCollectionButton';
import { RowActionsMenu } from './RowActionsMenu';
import { DeleteCollectionDialog } from './DeleteCollectionDialog';

export default function CollectionsListPage() {
  const [page, setPage] = useState<CollectionListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toDelete, setToDelete] = useState<CollectionListItem | null>(null);

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

  async function confirmDelete() {
    if (!toDelete) return;
    await api(`/api/admin/collections/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await load(search);
  }

  const items = page?.items ?? [];
  const manualCount = items.filter((c) => !c.isRulesBased).length;
  const smartCount = items.filter((c) => c.isRulesBased).length;

  return (
    <section className="max-w-5xl">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="h-page">Collections</h1>
        <CreateCollectionButton />
      </div>
      <div className="mb-5 flex items-center gap-4 text-xs text-stone-500">
        <span>
          <span className="tabular font-semibold text-stone-900">{items.length}</span>{' '}
          {items.length === 1 ? 'collection' : 'collections'}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-stone-500" aria-hidden />
          <span className="tabular font-semibold text-stone-900">{manualCount}</span>{' '}
          manual
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-indigo-500" aria-hidden />
          <span className="tabular font-semibold text-stone-900">{smartCount}</span>{' '}
          smart
        </span>
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
          className="input w-80"
        />
      </form>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty">
          No collections yet. Create one to start grouping products.
        </div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Handle</th>
              <th>Type</th>
              <th>Products</th>
              <th>Updated</th>
              <th></th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  <Link href={`/collections/${c.id}`} className="hover:underline">
                    {c.title}
                  </Link>
                </td>
                <td>
                  <span className="font-mono text-xs text-stone-600">{c.handle}</span>
                </td>
                <td>
                  <span
                    className={`badge ${c.isRulesBased ? 'badge-info' : 'badge-neutral'}`}
                  >
                    {c.isRulesBased ? 'Smart' : 'Manual'}
                  </span>
                </td>
                <td className="tabular-nums">
                  {c.isRulesBased ? (
                    <span className="text-stone-400">auto</span>
                  ) : (
                    c.productCount
                  )}
                </td>
                <td className="text-stone-500">
                  {new Date(c.updatedAt).toLocaleDateString()}
                </td>
                <td />
                <td>
                  <RowActionsMenu
                    label={`Actions for ${c.title}`}
                    actions={[
                      {
                        label: 'Delete',
                        destructive: true,
                        onClick: () => setToDelete(c),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DeleteCollectionDialog
        open={toDelete !== null}
        title={toDelete?.title ?? ''}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
