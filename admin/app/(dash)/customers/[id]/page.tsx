'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type CustomerDetail, type FinancialStatus } from '@/lib/types';

const FIN_BADGE: Record<FinancialStatus, string> = {
  pending: 'bg-gray-100 text-gray-800',
  authorized: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800',
  partially_paid: 'bg-amber-100 text-amber-800',
  refunded: 'bg-red-100 text-red-800',
  partially_refunded: 'bg-red-100 text-red-800',
  voided: 'bg-gray-100 text-gray-800',
};

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [c, setC] = useState<CustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grantOpen, setGrantOpen] = useState(false);

  async function load() {
    try {
      setC(await api<CustomerDetail>(`/api/admin/customers/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveNote(note: string) {
    setBusy(true);
    try {
      await api(`/api/admin/customers/${id}/note`, { method: 'PUT', body: JSON.stringify({ note }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveTags(tagsStr: string) {
    const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
    setBusy(true);
    try {
      await api(`/api/admin/customers/${id}/tags`, { method: 'PUT', body: JSON.stringify({ tags }) });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!c) {
    return <section><p className="text-[color:var(--color-text-muted)]">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  const name = `${c.firstName} ${c.lastName}`.trim() || c.email;
  return (
    <section className="max-w-5xl grid md:grid-cols-[1fr_320px] gap-6">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href="/customers" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Customers</Link>
          <h1 className="text-2xl font-semibold">{name}</h1>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>
        )}

        <Card title="Summary">
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Stat label="Orders" value={String(c.orderCount)} />
            <Stat label="Spent" value={formatPrice(c.totalSpentCents, c.storeCreditCurrency)} />
            <Stat label="Avg order" value={formatPrice(c.avgOrderCents, c.storeCreditCurrency)} />
            <Stat label="Last order" value={c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString() : '—'} />
            <Stat label="Store credit" value={formatPrice(c.storeCreditCents, c.storeCreditCurrency)} />
            <Stat label="Member since" value={new Date(c.createdAt).toLocaleDateString()} />
          </div>
        </Card>

        <Card title={`Recent orders (${c.recentOrders.length})`}>
          {c.recentOrders.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No orders.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)] text-sm">
              {c.recentOrders.map((o) => (
                <li key={o.id} className="py-2 flex items-center gap-3">
                  <Link href={`/orders/${o.id}`} className="font-medium hover:underline">{o.number}</Link>
                  <span className={`text-xs rounded px-2 py-0.5 ${FIN_BADGE[o.financialStatus]}`}>
                    {o.financialStatus.replace('_', ' ')}
                  </span>
                  <span className="text-xs text-[color:var(--color-text-muted)] flex-1">
                    {new Date(o.createdAt).toLocaleDateString()} · {o.itemsCount} items
                  </span>
                  <span className="font-medium">{formatPrice(o.totalCents, o.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Addresses (${c.addresses.length})`}>
          {c.addresses.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No addresses saved.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 text-sm">
              {c.addresses.map((a) => (
                <li key={a.id} className="border border-[color:var(--color-border)] rounded p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {a.label && <span className="font-medium">{a.label}</span>}
                    {a.isDefaultShipping && <span className="text-xs rounded bg-green-100 text-green-800 px-1.5 py-0.5">Shipping</span>}
                    {a.isDefaultBilling && <span className="text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5">Billing</span>}
                  </div>
                  <div className="text-xs">
                    {a.firstName} {a.lastName}<br/>
                    {a.addressLine1}{a.addressLine2 && <><br/>{a.addressLine2}</>}<br/>
                    {a.postalCode} {a.city}<br/>
                    {a.country}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Store credit (${formatPrice(c.storeCreditCents, c.storeCreditCurrency)})`}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[color:var(--color-text-muted)]">Balance · {c.ledgerEntries.length} entries</span>
            <button
              onClick={() => setGrantOpen(true)}
              className="px-3 py-1.5 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50"
            >
              Grant or adjust
            </button>
          </div>
          {c.ledgerEntries.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No ledger entries yet.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)] text-sm">
              {c.ledgerEntries.map((e) => (
                <li key={e.id} className="py-1.5 flex items-center gap-3">
                  <span className="text-xs text-[color:var(--color-text-muted)] w-32">
                    {new Date(e.createdAt).toLocaleString()}
                  </span>
                  <span className="capitalize text-xs w-24">{e.reason}</span>
                  <span className="flex-1 text-xs text-[color:var(--color-text-muted)]">{e.note}</span>
                  <span className={`font-medium ${e.deltaCents > 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {e.deltaCents > 0 ? '+' : ''}{formatPrice(e.deltaCents, c.storeCreditCurrency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <aside className="space-y-4 text-sm">
        <Card title="Contact">
          <div className="font-medium">{name}</div>
          <div className="text-[color:var(--color-text-muted)]">{c.email}</div>
          {c.phone && <div className="text-[color:var(--color-text-muted)]">{c.phone}</div>}
          <div className="text-xs text-[color:var(--color-text-muted)] mt-2">
            Marketing consent: {c.marketingConsent ? 'yes' : 'no'}
          </div>
        </Card>

        <Card title="Note">
          <NoteField initial={c.note} onSave={saveNote} busy={busy} />
        </Card>

        <Card title="Tags">
          <TagsField initial={c.tags} onSave={saveTags} busy={busy} />
        </Card>
      </aside>

      {grantOpen && <GrantModal customerId={id} currency={c.storeCreditCurrency} onClose={() => setGrantOpen(false)} onDone={async () => { setGrantOpen(false); await load(); }} />}
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[color:var(--color-text-muted)]">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function NoteField({ initial, onSave, busy }: { initial: string; onSave: (v: string) => void; busy: boolean }) {
  const [val, setVal] = useState(initial);
  useEffect(() => { setVal(initial); }, [initial]);
  const dirty = val !== initial;
  return (
    <div className="space-y-2">
      <textarea rows={3} value={val} onChange={(e) => setVal(e.target.value)} className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm" />
      <button onClick={() => onSave(val)} disabled={!dirty || busy} className="px-3 py-1 text-xs rounded border border-[color:var(--color-border)] disabled:opacity-50">Save note</button>
    </div>
  );
}

function TagsField({ initial, onSave, busy }: { initial: string[]; onSave: (v: string) => void; busy: boolean }) {
  const initialStr = initial.join(', ');
  const [val, setVal] = useState(initialStr);
  useEffect(() => { setVal(initialStr); }, [initialStr]);
  const dirty = val !== initialStr;
  return (
    <div className="space-y-2">
      <input value={val} onChange={(e) => setVal(e.target.value)} placeholder="vip, fashion, …" className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm" />
      <button onClick={() => onSave(val)} disabled={!dirty || busy} className="px-3 py-1 text-xs rounded border border-[color:var(--color-border)] disabled:opacity-50">Save tags</button>
    </div>
  );
}

function GrantModal({ customerId, currency, onClose, onDone }: { customerId: string; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState('10.00');
  const [reason, setReason] = useState('grant');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents === 0) {
      setError('Enter a non-zero amount (negative to debit)');
      setSubmitting(false);
      return;
    }
    try {
      await api(`/api/admin/customers/${customerId}/store-credit`, {
        method: 'POST',
        body: JSON.stringify({ amountCents: cents, reason, note }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Grant failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold">Grant or adjust store credit</h2>
        {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">{error}</div>}
        <label className="block">
          <div className="font-medium mb-1">Amount ({currency}) — negative to debit</div>
          <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Reason</div>
          <select value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white">
            <option value="grant">Grant (compensation / goodwill)</option>
            <option value="promotional">Promotional (birthday, etc.)</option>
            <option value="adjustment">Adjustment (correction)</option>
            <option value="refund">Refund-to-credit</option>
            <option value="expiration">Expiration (debit)</option>
          </select>
        </label>
        <label className="block">
          <div className="font-medium mb-1">Note</div>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={submit} disabled={submitting} className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {submitting ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
