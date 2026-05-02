'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type CustomerListItem, type CustomerListPage } from '@/lib/types';
import { ConfirmDialog, EntitySearchInput, RowActionsMenu } from '@/components/ui';
import { NewCustomerDialog } from './NewCustomerDialog';
import { GrantCreditDialog } from './GrantCreditDialog';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export default function CustomersListPage() {
  const router = useRouter();
  const [page, setPage] = useState<CustomerListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [grantFor, setGrantFor] = useState<CustomerListItem | null>(null);
  const [eraseFor, setEraseFor] = useState<CustomerListItem | null>(null);

  async function load() {
    try {
      const res = await api<CustomerListPage>(`/api/admin/customers?limit=50`);
      setPage(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => { load(); }, []);

  function showFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 3000);
  }

  async function sendPasswordSetup(c: CustomerListItem) {
    setError(null);
    try {
      await api(`/api/admin/customers/${c.id}/send-password-setup`, { method: 'POST' });
      showFlash(`Password-setup email sent to ${c.email}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Send failed');
    }
  }

  async function downloadExport(c: CustomerListItem) {
    setError(null);
    try {
      const res = await fetch(`${API}/api/admin/customers/${c.id}/data-export`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer-${c.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showFlash('Export downloaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  async function confirmErase() {
    if (!eraseFor) return;
    await api(`/api/admin/customers/${eraseFor.id}/erase`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Admin-initiated GDPR erasure' }),
    });
    setEraseFor(null);
    await load();
  }

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="h-page">Customers</h1>
          {page && <span className="badge badge-neutral no-dot">{page.total} total</span>}
        </div>
        <button type="button" onClick={() => setCreating(true)} className="btn btn-primary">
          + New customer
        </button>
      </div>

      <NewCustomerDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(c) => {
          setCreating(false);
          router.push(`/customers/${c.id}`);
        }}
      />

      <div className="mb-4 w-80">
        <EntitySearchInput
          kinds={['customer']}
          placeholder="Search customers — fuzzy match across email, name, phone…"
        />
      </div>

      {flash && <div className="alert alert-success mb-4">{flash}</div>}
      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : page.items.length === 0 ? (
        <div className="empty">No customers yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Orders</th>
              <th>Spent</th>
              <th>Last order</th>
              <th>Tags</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((c) => {
              const name = `${c.firstName} ${c.lastName}`.trim();
              const label = name || c.email;
              return (
                <tr key={c.id}>
                  <td>
                    <Link href={`/customers/${c.id}`} className="font-medium hover:underline">
                      {label}
                    </Link>
                    {name && <div className="text-xs text-stone-500">{c.email}</div>}
                  </td>
                  <td className="tabular-nums">{c.orderCount}</td>
                  <td className="font-medium tabular-nums">{formatPrice(c.totalSpentCents, c.currency)}</td>
                  <td className="text-stone-500">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span key={t} className="badge badge-neutral no-dot">{t}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <RowActionsMenu
                      label={`Actions for ${label}`}
                      actions={[
                        {
                          label: 'Edit',
                          onClick: () => router.push(`/customers/${c.id}`),
                        },
                        {
                          label: 'Send password setup email',
                          onClick: () => sendPasswordSetup(c),
                        },
                        {
                          label: 'Grant store credit',
                          onClick: () => setGrantFor(c),
                        },
                        {
                          label: 'GDPR data export',
                          onClick: () => downloadExport(c),
                        },
                        {
                          label: 'Erase account',
                          destructive: true,
                          onClick: () => setEraseFor(c),
                        },
                      ]}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {grantFor && (
        <GrantCreditDialog
          open
          customerId={grantFor.id}
          customerLabel={`${grantFor.firstName} ${grantFor.lastName}`.trim() || grantFor.email}
          currency={grantFor.currency}
          onClose={() => setGrantFor(null)}
          onDone={async () => {
            setGrantFor(null);
            showFlash('Store credit applied');
            await load();
          }}
        />
      )}

      <ConfirmDialog
        open={eraseFor !== null}
        title="Erase customer account?"
        description="All personal data is wiped (GDPR). Past orders are anonymized but kept for accounting. This cannot be undone."
        confirmLabel="Erase account"
        destructive
        onCancel={() => setEraseFor(null)}
        onConfirm={confirmErase}
      />
    </section>
  );
}
