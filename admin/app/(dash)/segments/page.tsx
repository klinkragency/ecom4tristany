'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { RowActionsMenu } from './RowActionsMenu';
import { DeleteSegmentDialog } from './DeleteSegmentDialog';

type Segment = {
  id: string;
  name: string;
  description: string;
  matchAll: boolean;
  memberCount: number;
  updatedAt: string;
};

export default function SegmentsPage() {
  const [items, setItems] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Segment | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const data = await api<{ items: Segment[] }>('/api/admin/segments');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function confirmDelete() {
    if (!toDelete) return;
    await api(`/api/admin/segments/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await load();
  }

  const totalMembers = items.reduce((acc, s) => acc + (s.memberCount ?? 0), 0);

  return (
    <section className="max-w-4xl">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="h-page">Segments</h1>
        <Link href="/segments/new" className="btn btn-primary">
          + New segment
        </Link>
      </div>
      <p className="mb-3 text-sm text-stone-500">
        Saved filters over your customer list. Each segment is a dynamic query
        — membership is always computed live from current customer data.
      </p>

      {items.length > 0 && (
        <div className="mb-5 flex items-center gap-4 text-xs text-stone-500">
          <span>
            <span className="tabular font-semibold text-stone-900">
              {items.length}
            </span>{' '}
            {items.length === 1 ? 'segment' : 'segments'}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full bg-indigo-500"
              aria-hidden
            />
            <span className="tabular font-semibold text-stone-900">
              {totalMembers}
            </span>{' '}
            total members across all
          </span>
        </div>
      )}

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!loaded ? (
        <div className="empty">Loading…</div>
      ) : items.length === 0 ? (
        <div className="empty">No segments yet. Create one to save a filter.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Name</th>
              <th>Match</th>
              <th>Members</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">
                  <Link
                    href={`/segments/${s.id}`}
                    className="hover:underline"
                  >
                    {s.name}
                  </Link>
                  {s.description && (
                    <div className="text-xs text-stone-500">{s.description}</div>
                  )}
                </td>
                <td>
                  <span className="badge badge-neutral no-dot">
                    {s.matchAll ? 'ALL' : 'ANY'}
                  </span>
                </td>
                <td className="tabular-nums">{s.memberCount}</td>
                <td>
                  <RowActionsMenu
                    label={`Actions for ${s.name}`}
                    actions={[
                      {
                        label: 'Delete',
                        destructive: true,
                        onClick: () => setToDelete(s),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <DeleteSegmentDialog
        open={toDelete !== null}
        name={toDelete?.name ?? ''}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
