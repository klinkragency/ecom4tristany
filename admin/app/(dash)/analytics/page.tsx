'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';

type Summary = {
  from: string;
  to: string;
  ordersPlaced: number;
  ordersPaid: number;
  grossRevenueCents: number;
  netRevenueCents: number;
  refundedCents: number;
  avgOrderCents: number;
  taxCollectedCents: number;
  discountedCents: number;
  storeCreditUsedCents: number;
  sessions: number;
  productViews: number;
  cartAdds: number;
  checkoutsStarted: number;
  conversionPct: number;
};

type SalesPoint = {
  bucket: string;
  orderCount: number;
  revenueCents: number;
  refundedCents: number;
};

type SalesResp = {
  from: string;
  to: string;
  granularity: string;
  points: SalesPoint[];
};

type TopProduct = {
  productId: string;
  title: string;
  handle: string;
  unitsSold: number;
  revenueCents: number;
};

type FunnelStep = { name: string; count: number };

const RANGES = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

export default function AnalyticsPage() {
  const [days, setDays] = useState<number>(30);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sales, setSales] = useState<SalesResp | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
      try {
        const [s, sa, tp, f] = await Promise.all([
          api<Summary>(`/api/admin/analytics/summary?${qs}`),
          api<SalesResp>(`/api/admin/analytics/sales?${qs}&granularity=${granularity}`),
          api<{ items: TopProduct[] }>(`/api/admin/analytics/top-products?${qs}&limit=10`),
          api<{ steps: FunnelStep[] }>(`/api/admin/analytics/funnel?${qs}`),
        ]);
        setSummary(s);
        setSales(sa);
        setTop(tp.items ?? []);
        setFunnel(f.steps ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [days, granularity]);

  return (
    <section className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="flex items-center gap-3">
          <Link href="/analytics/finance" className="text-sm hover:underline">Finance →</Link>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="px-3 py-1.5 text-sm rounded border border-[color:var(--color-border)] bg-white">
            {RANGES.map((r) => <option key={r.days} value={r.days}>Last {r.label}</option>)}
          </select>
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as 'day' | 'week' | 'month')}
            className="px-3 py-1.5 text-sm rounded border border-[color:var(--color-border)] bg-white">
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>
        </div>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KPI label="Gross revenue" value={summary ? formatPrice(summary.grossRevenueCents) : '…'} />
        <KPI label="Net revenue" value={summary ? formatPrice(summary.netRevenueCents) : '…'} sub={summary ? `${formatPrice(summary.refundedCents)} refunded` : undefined} />
        <KPI label="Orders paid" value={summary ? String(summary.ordersPaid) : '…'} sub={summary ? `${summary.ordersPlaced} placed` : undefined} />
        <KPI label="AOV" value={summary ? formatPrice(summary.avgOrderCents) : '…'} />
        <KPI label="Conversion" value={summary ? `${summary.conversionPct.toFixed(2)}%` : '…'} sub={summary ? `${summary.sessions} sessions` : undefined} />
        <KPI label="VAT collected" value={summary ? formatPrice(summary.taxCollectedCents) : '…'} />
        <KPI label="Discounts given" value={summary ? formatPrice(summary.discountedCents) : '…'} />
        <KPI label="Store credit used" value={summary ? formatPrice(summary.storeCreditUsedCents) : '…'} />
      </div>

      {/* Revenue chart */}
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 mb-6">
        <h2 className="text-sm font-semibold mb-2">Revenue over time</h2>
        {sales && sales.points.length > 0 ? (
          <LineChart points={sales.points} />
        ) : (
          <p className="text-sm text-[color:var(--color-text-muted)]">No data in range.</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Funnel */}
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4">
          <h2 className="text-sm font-semibold mb-3">Conversion funnel</h2>
          {funnel.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No events yet — the storefront tracker starts collecting on page load.</p>
          ) : (
            <Funnel steps={funnel} />
          )}
        </div>

        {/* Top products */}
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4">
          <h2 className="text-sm font-semibold mb-3">Top products</h2>
          {top.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-muted)]">No sales in range.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--color-border)] text-sm">
              {top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 py-2">
                  <span className="w-5 text-xs text-[color:var(--color-text-muted)]">{i + 1}</span>
                  <Link href={`/products/${p.productId}`} className="flex-1 hover:underline truncate">{p.title}</Link>
                  <span className="w-16 text-right text-xs text-[color:var(--color-text-muted)]">{p.unitsSold} u</span>
                  <span className="w-24 text-right font-medium">{formatPrice(p.revenueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-3">
      <div className="text-xs text-[color:var(--color-text-muted)]">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-[color:var(--color-text-muted)]">{sub}</div>}
    </div>
  );
}

function LineChart({ points }: { points: SalesPoint[] }) {
  const W = 720;
  const H = 180;
  const padL = 40;
  const padR = 10;
  const padT = 10;
  const padB = 24;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const maxY = Math.max(1, ...points.map((p) => p.revenueCents));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

  const path = points.map((p, i) => {
    const x = padL + i * stepX;
    const y = padT + innerH - (p.revenueCents / maxY) * innerH;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const ticks = [0, 0.5, 1].map((f) => ({
    y: padT + innerH - f * innerH,
    label: formatPrice(Math.round(maxY * f)),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="#e5e7eb" strokeDasharray="2,3" />
          <text x={padL - 4} y={t.y + 4} textAnchor="end" fontSize="10" fill="#6b7280">{t.label}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#111" strokeWidth="1.5" />
      {points.map((p, i) => {
        const x = padL + i * stepX;
        const y = padT + innerH - (p.revenueCents / maxY) * innerH;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="2.5" fill="#111" />
            <title>
              {new Date(p.bucket).toLocaleDateString()} — {formatPrice(p.revenueCents)} · {p.orderCount} orders
            </title>
          </g>
        );
      })}
      {points.length > 0 && (
        <>
          <text x={padL} y={H - 6} fontSize="10" fill="#6b7280" textAnchor="start">
            {new Date(points[0]!.bucket).toLocaleDateString()}
          </text>
          <text x={W - padR} y={H - 6} fontSize="10" fill="#6b7280" textAnchor="end">
            {new Date(points[points.length - 1]!.bucket).toLocaleDateString()}
          </text>
        </>
      )}
    </svg>
  );
}

function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <ul className="space-y-2 text-sm">
      {steps.map((s, i) => {
        const pct = (s.count / max) * 100;
        const conv = i > 0 && steps[i - 1]!.count > 0
          ? (s.count / steps[i - 1]!.count) * 100
          : null;
        return (
          <li key={s.name}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span>{s.name}</span>
              <span className="text-[color:var(--color-text-muted)]">
                {s.count.toLocaleString()}
                {conv !== null && ` · ${conv.toFixed(1)}% of prior`}
              </span>
            </div>
            <div className="h-2 rounded bg-gray-100 overflow-hidden">
              <div className="h-full bg-[color:var(--color-accent)]" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
