'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { Transfer } from '@/lib/types';

const BADGE: Record<Transfer['status'], string> = {
  draft: 'bg-gray-100 text-gray-800',
  in_transit: 'bg-amber-100 text-amber-800',
  received: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [t, setT] = useState<Transfer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setT(await api<Transfer>(`/api/admin/transfers/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, [id]);

  async function transition(action: 'ship' | 'receive' | 'cancel') {
    const labels = { ship: 'Ship this transfer?', receive: 'Mark as received?', cancel: 'Cancel this draft?' };
    if (!confirm(labels[action])) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/admin/transfers/${id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!t) {
    return <section><p className="text-stone-500">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  return (
    <section className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/inventory/transfers" className="text-sm text-stone-500 hover:underline">
            ← Transfers
          </Link>
          <h1 className="h-page">{t.fromName} → {t.toName}</h1>
          <span className={`inline-block rounded px-2 py-0.5 text-xs ${BADGE[t.status]}`}>
            {t.status.replace('_', ' ')}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {t.status === 'draft' && (
            <>
              <button onClick={() => transition('cancel')} disabled={busy} className="btn btn-secondary">
                Cancel draft
              </button>
              <button onClick={() => transition('ship')} disabled={busy} className="btn btn-primary">
                Ship
              </button>
            </>
          )}
          {t.status === 'in_transit' && (
            <button onClick={() => transition('receive')} disabled={busy} className="btn btn-primary">
              Mark received
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 alert alert-error">{error}</div>
      )}

      {t.note && (
        <div className="card card-pad mb-4 text-sm">
          <span className="label">Note</span>
          <div className="text-stone-500">{t.note}</div>
        </div>
      )}

      <div className="card overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Variant</th>
              <th className="px-3 py-2 font-medium">SKU</th>
              <th className="px-3 py-2 font-medium text-right">Quantity</th>
            </tr>
          </thead>
          <tbody>
            {t.items.map((it) => (
              <tr key={it.variantId} className="border-t border-stone-200">
                <td className="px-3 py-2">{it.label}</td>
                <td className="px-3 py-2 text-stone-500">{it.sku || '—'}</td>
                <td className="px-3 py-2 text-right">{it.quantity}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 border-t border-stone-200">
              <td colSpan={2} className="px-3 py-2 text-right font-medium">Total units</td>
              <td className="px-3 py-2 text-right font-medium">{t.totalUnits}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card card-pad text-xs text-stone-500 space-y-0.5">
        <div>Created: {new Date(t.createdAt).toLocaleString()}</div>
        {t.shippedAt && <div>Shipped: {new Date(t.shippedAt).toLocaleString()}</div>}
        {t.receivedAt && <div>Received: {new Date(t.receivedAt).toLocaleString()}</div>}
      </div>

      {t.status === 'cancelled' && (
        <button
          onClick={() => router.push('/inventory/transfers')}
          className="mt-4 text-sm text-stone-500 hover:underline"
        >
          Back to list
        </button>
      )}
    </section>
  );
}
