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
      <div className="flex items-center gap-3 mb-4">
        <Link href="/content" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Content</Link>
        <h1 className="text-2xl font-semibold flex-1">Metaobjects</h1>
        <Link href="/content/metaobjects/new"
          className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">
          + New type
        </Link>
      </div>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        User-defined content types. Each type defines a schema (fields) and can have many entries —
        e.g. a <span className="font-mono">size_chart</span> type whose entries are individual charts,
        or a <span className="font-mono">faq_item</span> type whose entries are individual Q&amp;As.
      </p>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No types yet. Create one to start adding custom content.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
          {items.map((t) => (
            <li key={t.id}>
              <Link href={`/content/metaobjects/${t.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-sm">
                <div className="flex-1">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-[color:var(--color-text-muted)] font-mono">{t.handle}</div>
                  {t.description && (
                    <div className="text-xs text-[color:var(--color-text-muted)] mt-0.5">{t.description}</div>
                  )}
                </div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  {t.entryCount} entr{t.entryCount === 1 ? 'y' : 'ies'}
                </div>
                <div className="text-xs text-[color:var(--color-text-muted)]">
                  {t.fieldDefs.length} field{t.fieldDefs.length === 1 ? '' : 's'}
                </div>
                <span className="text-[color:var(--color-text-muted)]">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
