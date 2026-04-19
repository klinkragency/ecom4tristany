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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Segments</h1>
        <button
          onClick={create}
          disabled={creating}
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'New segment'}
        </button>
      </div>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        Saved filters over your customer list. Each segment is a dynamic query — membership
        is always computed live from current customer data.
      </p>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No segments yet. Create one to save a filter.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
          {items.map((s) => (
            <li key={s.id} className="p-3 flex items-center gap-3">
              <div className="flex-1">
                <Link href={`/segments/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                {s.description && (
                  <div className="text-xs text-[color:var(--color-text-muted)]">{s.description}</div>
                )}
              </div>
              <div className="text-xs text-[color:var(--color-text-muted)]">
                {s.matchAll ? 'ALL' : 'ANY'} · {s.memberCount} members
              </div>
              <Link href={`/segments/${s.id}`} className="text-xs underline">Edit</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
