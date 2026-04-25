'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';

type SalesRow = {
  country: string;
  ordersPaid: number;
  grossRevenueCents: number;
  taxCollectedCents: number;
  shippingCents: number;
  discountedCents: number;
};

type RefundBucket = {
  reason: string;
  count: number;
  amountCents: number;
};

type Refunds = {
  from: string;
  to: string;
  totalCount: number;
  totalCents: number;
  cardCents: number;
  storeCreditCents: number;
  byReason: RefundBucket[];
};

type StoreCredit = {
  totalLiabilityCents: number;
  customerCount: number;
  currency: string;
};

type Payout = {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  arrivalDate: number;
  created: number;
  method: string;
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export default function FinancePage() {
  const [days, setDays] = useState<number>(30);
  const [sales, setSales] = useState<SalesRow[]>([]);
  const [refunds, setRefunds] = useState<Refunds | null>(null);
  const [credit, setCredit] = useState<StoreCredit | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
      try {
        const [s, r, c, p] = await Promise.all([
          api<{ items: SalesRow[] }>(`/api/admin/analytics/finance/sales?${qs}`),
          api<Refunds>(`/api/admin/analytics/finance/refunds?${qs}`),
          api<StoreCredit>('/api/admin/analytics/finance/store-credit'),
          api<{ items: Payout[] }>('/api/admin/analytics/finance/payouts?limit=10').catch(() => ({ items: [] })),
        ]);
        setSales(s.items ?? []);
        setRefunds(r);
        setCredit(c);
        setPayouts(p.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [days]);

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const csvHref = `${API}/api/admin/analytics/finance/sales?from=${from.toISOString()}&to=${to.toISOString()}&format=csv`;

  return (
    <section className="max-w-5xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/analytics" className="text-sm text-stone-500 hover:underline">← Analytics</Link>
        <h1 className="h-page flex-1">Finance</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="px-3 py-1.5 text-sm rounded border border-stone-200 bg-white">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>
      {error && <div className="mb-3 alert alert-error">{error}</div>}

      {/* Sales by country */}
      <Card title="Sales by country (VAT jurisdictions)">
        <div className="flex items-center justify-end mb-2">
          <a href={csvHref} className="text-xs hover:underline">Download CSV →</a>
        </div>
        {sales.length === 0 ? (
          <p className="text-sm text-stone-500">No paid orders in range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1">Country</th>
                <th className="py-1 text-right">Orders</th>
                <th className="py-1 text-right">Gross</th>
                <th className="py-1 text-right">VAT</th>
                <th className="py-1 text-right">Shipping</th>
                <th className="py-1 text-right">Discounts</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.country} className="border-t border-stone-200">
                  <td className="py-1.5 font-mono">{s.country}</td>
                  <td className="py-1.5 text-right">{s.ordersPaid}</td>
                  <td className="py-1.5 text-right font-medium">{formatPrice(s.grossRevenueCents)}</td>
                  <td className="py-1.5 text-right">{formatPrice(s.taxCollectedCents)}</td>
                  <td className="py-1.5 text-right">{formatPrice(s.shippingCents)}</td>
                  <td className="py-1.5 text-right">{formatPrice(s.discountedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Refunds */}
      <Card title="Refunds">
        {refunds ? (
          <div className="grid grid-cols-3 gap-3 text-sm mb-3">
            <Stat label="Total refunded" value={formatPrice(refunds.totalCents)} sub={`${refunds.totalCount} refunds`} />
            <Stat label="To card" value={formatPrice(refunds.cardCents)} />
            <Stat label="To store credit" value={formatPrice(refunds.storeCreditCents)} />
          </div>
        ) : null}
        {refunds && refunds.byReason.length > 0 && (
          <ul className="divide-y divide-stone-200 text-sm">
            {refunds.byReason.map((b) => (
              <li key={b.reason} className="py-1.5 flex items-center gap-3">
                <span className="flex-1 truncate">{b.reason}</span>
                <span className="text-xs text-stone-500">{b.count}</span>
                <span className="w-24 text-right font-medium">{formatPrice(b.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {refunds && refunds.byReason.length === 0 && (
          <p className="text-sm text-stone-500">No refunds in range.</p>
        )}
      </Card>

      {/* Store credit liability */}
      <Card title="Store credit liability">
        {credit ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Outstanding balance" value={formatPrice(credit.totalLiabilityCents, credit.currency)} />
            <Stat label="Customers holding credit" value={String(credit.customerCount)} />
          </div>
        ) : null}
      </Card>

      {/* Stripe payouts */}
      <Card title="Recent Stripe payouts">
        {payouts.length === 0 ? (
          <p className="text-sm text-stone-500">No payouts found (or Stripe not configured).</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-stone-500">
              <tr>
                <th className="py-1">Arrival</th>
                <th className="py-1">Status</th>
                <th className="py-1">Method</th>
                <th className="py-1 text-right">Amount</th>
                <th className="py-1">ID</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((p) => (
                <tr key={p.id} className="border-t border-stone-200">
                  <td className="py-1.5">{new Date(p.arrivalDate * 1000).toLocaleDateString()}</td>
                  <td className="py-1.5">
                    <span className={`text-xs rounded px-1.5 py-0.5 ${payoutBadge(p.status)}`}>{p.status}</span>
                  </td>
                  <td className="py-1.5 text-xs">{p.method}</td>
                  <td className="py-1.5 text-right font-medium">{formatPrice(p.amountCents, p.currency.toUpperCase())}</td>
                  <td className="py-1.5 font-mono text-xs text-stone-500">{p.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad mb-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-stone-500">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
    </div>
  );
}

function payoutBadge(status: string): string {
  switch (status) {
    case 'paid': return 'bg-green-100 text-green-800';
    case 'in_transit': return 'bg-amber-100 text-amber-800';
    case 'pending': return 'bg-gray-100 text-gray-800';
    case 'failed':
    case 'canceled': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}
