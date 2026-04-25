'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import EntryForm, { EMPTY_ENTRY, type EntryPayload } from '../../EntryForm';
import type { FieldDef } from '../../../TypeForm';

export default function NewEntryPage() {
  const params = useParams<{ typeId: string }>();
  const router = useRouter();
  const typeId = params.typeId;
  const [fieldDefs, setFieldDefs] = useState<FieldDef[] | null>(null);
  const [typeName, setTypeName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const t = await api<{ name: string; fieldDefs: FieldDef[] }>(`/api/admin/content/metaobjects/types/${typeId}`);
        setFieldDefs(t.fieldDefs ?? []);
        setTypeName(t.name);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [typeId]);

  async function save(p: EntryPayload) {
    await api(`/api/admin/content/metaobjects/types/${typeId}/entries`, {
      method: 'POST', body: JSON.stringify(p),
    });
    router.push(`/content/metaobjects/${typeId}`);
  }

  if (!fieldDefs) {
    return <section><p className="text-stone-500">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  return (
    <section>
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/content/metaobjects/${typeId}`} className="text-sm text-stone-500 hover:underline">← {typeName}</Link>
        <h1 className="h-page">New entry</h1>
      </div>
      <EntryForm initial={EMPTY_ENTRY} fieldDefs={fieldDefs} onSave={save} saveLabel="Create" />
    </section>
  );
}
