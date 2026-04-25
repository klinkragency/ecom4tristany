'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import TypeForm, { EMPTY_TYPE, type TypePayload } from '../TypeForm';

type Entry = {
  id: string;
  handle: string;
  name: string;
  status: 'draft' | 'published';
  updatedAt: string;
};

export default function TypeDetailPage() {
  const params = useParams<{ typeId: string }>();
  const router = useRouter();
  const typeId = params.typeId;

  const [initial, setInitial] = useState<TypePayload | null>(null);
  const [typeName, setTypeName] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [t, list] = await Promise.all([
        api<{ handle: string; name: string; description: string; fieldDefs: TypePayload['fieldDefs'] }>(`/api/admin/content/metaobjects/types/${typeId}`),
        api<{ items: Entry[] }>(`/api/admin/content/metaobjects/types/${typeId}/entries`),
      ]);
      setInitial({
        ...EMPTY_TYPE,
        handle: t.handle,
        name: t.name,
        description: t.description,
        fieldDefs: t.fieldDefs ?? [],
      });
      setTypeName(t.name);
      setEntries(list.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [typeId]);

  async function save(p: TypePayload) {
    await api(`/api/admin/content/metaobjects/types/${typeId}`, {
      method: 'PUT', body: JSON.stringify(p),
    });
    await load();
  }

  async function del() {
    if (!confirm(`Delete type "${typeName}" and all its entries?`)) return;
    try {
      await api(`/api/admin/content/metaobjects/types/${typeId}`, { method: 'DELETE' });
      router.push('/content/metaobjects');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!initial) {
    return <section><p className="text-stone-500">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  return (
    <section className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/content/metaobjects" className="text-sm text-stone-500 hover:underline">← Metaobjects</Link>
        <h1 className="text-2xl font-semibold">{typeName || 'Edit type'}</h1>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Schema</h2>
        <TypeForm initial={initial} onSave={save} saveLabel="Save changes" onDelete={del} />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Entries ({entries.length})</h2>
          <Link href={`/content/metaobjects/${typeId}/entries/new`}
            className="px-3 py-2 text-sm rounded bg-stone-900 text-white">
            + New entry
          </Link>
        </div>
        {entries.length === 0 ? (
          <div className="rounded border border-dashed border-stone-200 p-8 text-center text-sm text-stone-500">
            No entries yet.
          </div>
        ) : (
          <ul className="divide-y divide-stone-200 border border-stone-200 rounded bg-white">
            {entries.map((e) => (
              <li key={e.id}>
                <Link href={`/content/metaobjects/${typeId}/entries/${e.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 text-sm">
                  <div className="flex-1">
                    <div className="font-medium">{e.name}</div>
                    <div className="text-xs text-stone-500 font-mono">{e.handle}</div>
                  </div>
                  <span className={`text-xs rounded px-2 py-0.5 ${e.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {e.status}
                  </span>
                  <span className="text-stone-500">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
