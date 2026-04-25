'use client';

import { useEffect, useState } from 'react';
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
  POST: 'badge-info',
  PUT: 'badge-warning',
  PATCH: 'badge-warning',
  DELETE: 'badge-danger',
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
    <div className="max-w-5xl space-y-3">
      <div className="flex items-center justify-end">
        <select value={resourceFilter} onChange={(e) => setResourceFilter(e.target.value)} className="select w-auto">
          <option value="">All resources</option>
          {resourceTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      {error && <div className="alert alert-error">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No entries.</div>
      ) : (
        <div className="card divide-y divide-stone-200/60 text-sm">
          {items.map((e) => (
            <div key={e.id}>
              <button
                onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-stone-50/70"
              >
                <span className={`badge ${METHOD_BADGE[e.method] ?? 'badge-neutral'} no-dot w-16 justify-center font-mono`}>
                  {e.method}
                </span>
                <span className="flex-1 truncate font-mono text-xs">{e.path}</span>
                <span className={`font-mono text-xs tabular-nums ${e.status >= 400 ? 'text-red-700' : 'text-stone-500'}`}>
                  {e.status}
                </span>
                <span className="w-48 truncate text-xs text-stone-500">{e.adminEmail || '—'}</span>
                <span className="w-36 text-right text-xs text-stone-500">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </button>
              {expanded === e.id && (
                <div className="bg-stone-50 px-4 py-3 text-xs">
                  <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1">
                    <span><b>Resource:</b> {e.resourceType}/{e.resourceId || '—'}</span>
                    <span><b>IP:</b> {e.ip}</span>
                    <span className="max-w-xl truncate"><b>UA:</b> {e.userAgent}</span>
                  </div>
                  <pre className="overflow-x-auto rounded-lg border border-stone-200 bg-white p-3 font-mono text-xs">
                    {JSON.stringify(e.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
