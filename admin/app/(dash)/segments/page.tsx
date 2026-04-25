'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

type Segment = {
  id: string;
  name: string;
  description: string;
  matchAll: boolean;
  memberCount: number;
  updatedAt: string;
};

export default function SegmentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const data = await api<{ items: Segment[] }>('/api/admin/segments');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    setCreating(true);
    try {
      const s = await api<Segment>('/api/admin/segments', {
        method: 'POST',
        body: JSON.stringify({
          name: 'New segment',
          description: '',
          matchAll: true,
          rules: [],
        }),
      });
      router.push(`/segments/${s.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="max-w-4xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Segments</h1>
        <button onClick={create} disabled={creating} className="btn btn-primary">
          {creating ? 'Creating…' : 'New segment'}
        </button>
      </div>
      <p className="mb-4 text-sm text-stone-500">
        Saved filters over your customer list. Each segment is a dynamic query — membership
        is always computed live from current customer data.
      </p>
      {error && <div className="alert alert-error mb-4">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No segments yet. Create one to save a filter.</div>
      ) : (
        <div className="card divide-y divide-stone-200/60">
          {items.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-5 py-4">
              <div className="flex-1 min-w-0">
                <Link href={`/segments/${s.id}`} className="text-sm font-medium hover:underline">{s.name}</Link>
                {s.description && (
                  <div className="text-xs text-stone-500">{s.description}</div>
                )}
              </div>
              <span className="badge badge-neutral no-dot">
                {s.matchAll ? 'ALL' : 'ANY'} · {s.memberCount} members
              </span>
              <Link href={`/segments/${s.id}`} className="btn btn-ghost btn-sm">Edit</Link>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
