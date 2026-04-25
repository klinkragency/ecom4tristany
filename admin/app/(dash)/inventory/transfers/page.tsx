'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { Transfer } from '@/lib/types';

const BADGE: Record<Transfer['status'], string> = {
  draft: 'bg-gray-100 text-gray-800',
  in_transit: 'bg-amber-100 text-amber-800',
  received: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function TransfersListPage() {
  const [list, setList] = useState<Transfer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Transfer[]>('/api/admin/transfers')
      .then(setList)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Load failed'));
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="h-page">Stock transfers</h1>
        <Link
          href="/inventory/transfers/new"
          className="px-3 py-2 text-sm rounded bg-stone-900 text-white hover:bg-stone-800"
        >
          New transfer
        </Link>
      </div>

      {error && (
        <div className="mb-3 alert alert-error">{error}</div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">From → To</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Units</th>
              <th className="px-3 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {!list && <tr><td colSpan={4} className="px-3 py-6 text-center text-stone-500">Loading…</td></tr>}
            {list && list.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-stone-500">No transfers yet.</td></tr>
            )}
            {list?.map((t) => (
              <tr key={t.id} className="border-t border-stone-200 hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/inventory/transfers/${t.id}`} className="hover:underline">
                    {t.fromName} → {t.toName}
                  </Link>
                  {t.note && <div className="text-xs text-stone-500">{t.note}</div>}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs ${BADGE[t.status]}`}>
                    {t.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-2">{t.totalUnits}</td>
                <td className="px-3 py-2 text-stone-500">
                  {new Date(t.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
