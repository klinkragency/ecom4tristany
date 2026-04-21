'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type AuditEntry = {
  id: string;
  adminEmail: string;
  method: string;
  path: string;
  status: number;
  resourceType: string;
  resourceId: string;
  ip: string;
  userAgent: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

const METHOD_BADGE: Record<string, string> = {
  POST: 'bg-blue-100 text-blue-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-amber-100 text-amber-800',
  DELETE: 'bg-red-100 text-red-800',
};

export default function AuditPage() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [resourceFilter, setResourceFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const qs = resourceFilter ? `?resourceType=${encodeURIComponent(resourceFilter)}` : '';
        const data = await api<{ items: AuditEntry[] }>(`/api/admin/audit${qs}`);
        setItems(data.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [resourceFilter]);

  const resourceTypes = Array.from(new Set(items.map((i) => i.resourceType).filter(Boolean))).sort();

  return (
    <section className="max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold flex-1">Audit log</h1>
        <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)}
          className="px-2 py-1.5 text-sm rounded border border-[color:var(--color-border)] bg-white">
          <option value="">All resources</option>
          {resourceTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-[color:var(--color-border)] p-8 text-center text-sm text-[color:var(--color-text-muted)]">
          No entries.
        </div>
      ) : (
        <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white text-sm">
          {items.map((e) => (
            <li key={e.id}>
              <button onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="w-full text-left flex items-center gap-3 px-3 py-2 hover:bg-gray-50">
                <span className={`text-xs font-mono rounded px-1.5 py-0.5 w-16 text-center ${METHOD_BADGE[e.method] ?? 'bg-gray-100 text-gray-800'}`}>
                  {e.method}
                </span>
                <span className="font-mono text-xs truncate flex-1">{e.path}</span>
                <span className={`text-xs font-mono ${e.status >= 400 ? 'text-red-700' : 'text-[color:var(--color-text-muted)]'}`}>
                  {e.status}
                </span>
                <span className="text-xs w-48 truncate text-[color:var(--color-text-muted)]">{e.adminEmail || '—'}</span>
                <span className="text-xs w-36 text-right text-[color:var(--color-text-muted)]">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </button>
              {expanded === e.id && (
                <div className="px-3 py-2 bg-gray-50 text-xs">
                  <div className="flex flex-wrap gap-x-6 gap-y-1 mb-2">
                    <span><b>Resource:</b> {e.resourceType}/{e.resourceId || '—'}</span>
                    <span><b>IP:</b> {e.ip}</span>
                    <span className="truncate max-w-xl"><b>UA:</b> {e.userAgent}</span>
                  </div>
                  <pre className="font-mono text-xs bg-white border border-[color:var(--color-border)] rounded p-2 overflow-x-auto">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
