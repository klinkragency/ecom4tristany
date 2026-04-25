'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import EntryForm, { EMPTY_ENTRY, type EntryPayload } from '../../EntryForm';
import type { FieldDef } from '../../../TypeForm';

export default function EditEntryPage() {
  const params = useParams<{ typeId: string; entryId: string }>();
  const router = useRouter();
  const { typeId, entryId } = params;

  const [fieldDefs, setFieldDefs] = useState<FieldDef[] | null>(null);
  const [typeName, setTypeName] = useState('');
  const [initial, setInitial] = useState<EntryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [t, e] = await Promise.all([
          api<{ name: string; fieldDefs: FieldDef[] }>(`/api/admin/content/metaobjects/types/${typeId}`),
          api<{ handle: string; name: string; status: 'draft' | 'published'; fields: Record<string, unknown>; position: number }>(`/api/admin/content/metaobjects/entries/${entryId}`),
        ]);
        setFieldDefs(t.fieldDefs ?? []);
        setTypeName(t.name);
        setInitial({
          ...EMPTY_ENTRY,
          handle: e.handle,
          name: e.name,
          status: e.status,
          fields: e.fields ?? {},
          position: e.position ?? 0,
        });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [typeId, entryId]);

  async function save(p: EntryPayload) {
    await api(`/api/admin/content/metaobjects/entries/${entryId}`, {
      method: 'PUT', body: JSON.stringify(p),
    });
  }

  async function del() {
    if (!confirm('Delete this entry?')) return;
    try {
      await api(`/api/admin/content/metaobjects/entries/${entryId}`, { method: 'DELETE' });
      router.push(`/content/metaobjects/${typeId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!fieldDefs || !initial) {
    return <section><p className="text-stone-500">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/content/metaobjects/${typeId}`} className="text-sm text-stone-500 hover:underline">← {typeName}</Link>
        <h1 className="h-page">{initial.name || 'Edit entry'}</h1>
      </div>
      <EntryForm initial={initial} fieldDefs={fieldDefs} onSave={save} saveLabel="Save changes" onDelete={del} />
    </section>
  );
}
