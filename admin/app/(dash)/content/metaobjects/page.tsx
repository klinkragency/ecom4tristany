'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type MetaType = {
  id: string;
  handle: string;
  name: string;
  description: string;
  fieldDefs: unknown[];
  entryCount: number;
  updatedAt: string;
};

export default function MetaobjectsListPage() {
  const [items, setItems] = useState<MetaType[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ items: MetaType[] }>('/api/admin/content/metaobjects/types');
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, []);

  return (
    <section className="max-w-5xl">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/content" className="text-sm text-stone-500 hover:underline">← Content</Link>
        <h1 className="h-page flex-1">Metaobjects</h1>
        <Link href="/content/metaobjects/new" className="btn btn-primary">
          + New type
        </Link>
      </div>
      <p className="mb-5 text-sm text-stone-500">
        User-defined content types. Each type defines a schema (fields) and can have many entries —
        e.g. a <span className="font-mono">size_chart</span> type whose entries are individual charts,
        or a <span className="font-mono">faq_item</span> type whose entries are individual Q&amp;As.
      </p>
      {error && <div className="alert alert-error mb-4">{error}</div>}
      {items.length === 0 ? (
        <div className="empty">No types yet. Create one to start adding custom content.</div>
      ) : (
        <div className="card divide-y divide-stone-200/60">
          {items.map((t) => (
            <Link
              key={t.id}
              href={`/content/metaobjects/${t.id}`}
              className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-stone-50/70"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{t.name}</div>
                <div className="font-mono text-xs text-stone-500">{t.handle}</div>
                {t.description && (
                  <div className="mt-0.5 text-xs text-stone-500">{t.description}</div>
                )}
              </div>
              <span className="badge badge-neutral no-dot">
                {t.entryCount} entr{t.entryCount === 1 ? 'y' : 'ies'}
              </span>
              <span className="badge badge-neutral no-dot">
                {t.fieldDefs.length} field{t.fieldDefs.length === 1 ? '' : 's'}
              </span>
              <span className="text-stone-400 transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
