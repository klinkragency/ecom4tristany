'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { RowActionsMenu, type RowAction } from '@/components/ui';
import { CreateDiscountButton } from './CreateDiscountButton';
import { DeleteDiscountDialog } from './DeleteDiscountDialog';
import { normalizeDiscount, type DiscountResponse } from './_forms/shared/types';

type Discount = {
  id: string;
  code?: string | null;
  title: string;
  kind: 'percentage' | 'amount' | 'free_shipping' | 'bogo';
  valuePercent?: number | null;
  valueCents?: number | null;
  scope: 'all' | 'products' | 'collections';
  eligibility: 'all' | 'segments';
  usageCount: number;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

function describe(d: Discount): string {
  switch (d.kind) {
    case 'percentage': return `${d.valuePercent ?? 0}% off`;
    case 'amount': return `${((d.valueCents ?? 0) / 100).toFixed(2)} € off`;
    case 'free_shipping': return 'Free shipping';
    case 'bogo': return 'Buy X Get Y';
  }
}

export default function DiscountsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Discount | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await api<{ items: Discount[] }>('/api/admin/discounts');
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(d: Discount) {
    setPendingId(d.id);
    setError(null);
    try {
      // PUT requires the full writable payload — fetch the canonical record
      // and normalize away read-only fields (id, usageCount, …) that the
      // backend's DisallowUnknownFields decoder rejects.
      const raw = await api<DiscountResponse>(`/api/admin/discounts/${d.id}`);
      const full = normalizeDiscount(raw);
      await api(`/api/admin/discounts/${d.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...full, active: !d.active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setPendingId(null);
    }
  }

  async function copyCode(d: Discount) {
    if (!d.code) return;
    try {
      await navigator.clipboard.writeText(d.code);
      setCopiedId(d.id);
      window.setTimeout(() => {
        setCopiedId((cur) => (cur === d.id ? null : cur));
      }, 2000);
    } catch {
      setError('Copy failed — clipboard unavailable');
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    await api(`/api/admin/discounts/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await load();
  }

  return (
    <section className="max-w-5xl">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="h-page">Discounts</h1>
        <CreateDiscountButton />
      </div>
      <div className="mb-5 flex items-center gap-4 text-xs text-stone-500">
        <span>
          <span className="tabular font-semibold text-stone-900">{items.length}</span>{' '}
          {items.length === 1 ? 'discount' : 'discounts'}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          <span className="tabular font-semibold text-stone-900">
            {items.filter((d) => d.active).length}
          </span>{' '}
          active
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-stone-300" aria-hidden />
          <span className="tabular font-semibold text-stone-900">
            {items.filter((d) => !d.active).length}
          </span>{' '}
          inactive
        </span>
      </div>
      {error && <div className="alert alert-error mb-4">{error}</div>}

      {items.length === 0 ? (
        <div className="empty">No discounts yet. Create one to run your first promo.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Code</th>
              <th>Type</th>
              <th>Scope</th>
              <th>Used</th>
              <th>Status</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((d) => {
              const actions: RowAction[] = [
                {
                  label: 'Edit',
                  onClick: () => router.push(`/discounts/${d.id}`),
                },
              ];
              if (d.code) {
                actions.push({
                  label: copiedId === d.id ? 'Copied' : 'Copy code',
                  onClick: () => copyCode(d),
                });
              }
              actions.push({
                label: d.active ? 'Deactivate' : 'Activate',
                onClick: () => toggleActive(d),
                disabled: pendingId === d.id,
              });
              actions.push({
                label: 'Delete',
                destructive: true,
                onClick: () => setToDelete(d),
              });
              return (
                <tr key={d.id} className={pendingId === d.id ? 'opacity-60' : ''}>
                  <td className="font-medium">
                    <Link href={`/discounts/${d.id}`} className="hover:underline">{d.title}</Link>
                  </td>
                  <td>
                    {d.code ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono text-xs">{d.code}</span>
                        {copiedId === d.id && (
                          <span className="text-xs font-medium text-emerald-600">Copied</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-stone-400 italic">automatic</span>
                    )}
                  </td>
                  <td>{describe(d)}</td>
                  <td className="text-stone-500 capitalize">{d.scope}</td>
                  <td className="tabular-nums">{d.usageCount}</td>
                  <td>
                    <span className={`badge ${d.active ? 'badge-success' : 'badge-neutral'}`}>
                      {d.active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td>
                    <RowActionsMenu
                      label={`Actions for ${d.title}`}
                      actions={actions}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <DeleteDiscountDialog
        open={toDelete !== null}
        title={toDelete?.title ?? ''}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}
