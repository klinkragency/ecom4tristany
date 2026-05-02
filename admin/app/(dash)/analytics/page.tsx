'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice } from '@/lib/types';
import { Select } from '@/components/ui';

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

type PostHog = {
  from: string;
  to: string;
  configured: boolean;
  dashboardUrl?: string;
  uniqueVisitors: number;
  totalEvents: number;
  pageviews: number;
  topEvents: { event: string; count: number }[];
  topPages: { path: string; count: number }[];
  error?: string;
};

type SessionsByCountry = {
  from: string;
  windowMinutes: number;
  totalSessions: number;
  items: { country: string; sessions: number }[];
};

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
  const [posthog, setPosthog] = useState<PostHog | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days);
      const qs = `from=${from.toISOString()}&to=${to.toISOString()}`;
      try {
        const [s, sa, tp, f, ph] = await Promise.all([
          api<Summary>(`/api/admin/analytics/summary?${qs}`),
          api<SalesResp>(`/api/admin/analytics/sales?${qs}&granularity=${granularity}`),
          api<{ items: TopProduct[] }>(`/api/admin/analytics/top-products?${qs}&limit=10`),
          api<{ steps: FunnelStep[] }>(`/api/admin/analytics/funnel?${qs}`),
          api<PostHog>(`/api/admin/analytics/posthog/overview?${qs}`).catch(() => null),
        ]);
        setSummary(s);
        setSales(sa);
        setTop(tp.items ?? []);
        setFunnel(f.steps ?? []);
        setPosthog(ph);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, [days, granularity]);

  return (
    <section className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="h-page">Analytics</h1>
        <div className="flex items-center gap-3">
          <Link href="/analytics/finance" className="text-sm hover:underline">Finance →</Link>
          <div className="w-36">
            <Select
              ariaLabel="Date range"
              value={String(days)}
              onChange={(v) => setDays(Number(v))}
              options={RANGES.map((r) => ({ value: String(r.days), label: `Last ${r.label}` }))}
            />
          </div>
          <div className="w-32">
            <Select<'day' | 'week' | 'month'>
              ariaLabel="Granularity"
              value={granularity}
              onChange={setGranularity}
              options={[
                { value: 'day', label: 'Daily' },
                { value: 'week', label: 'Weekly' },
                { value: 'month', label: 'Monthly' },
              ]}
            />
          </div>
        </div>
      </div>
      {error && <div className="mb-3 alert alert-error">{error}</div>}

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
      <div className="card card-pad mb-6">
        <h2 className="text-sm font-semibold mb-2">Revenue over time</h2>
        {sales && sales.points.length > 0 ? (
          <LineChart points={sales.points} />
        ) : (
          <p className="text-sm text-stone-500">No data in range.</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Funnel */}
        <div className="card card-pad">
          <h2 className="text-sm font-semibold mb-3">Conversion funnel</h2>
          {funnel.length === 0 ? (
            <p className="text-sm text-stone-500">No events yet — the storefront tracker starts collecting on page load.</p>
          ) : (
            <Funnel steps={funnel} />
          )}
        </div>

        {/* Top products */}
        <div className="card card-pad">
          <h2 className="text-sm font-semibold mb-3">Top products</h2>
          {top.length === 0 ? (
            <p className="text-sm text-stone-500">No sales in range.</p>
          ) : (
            <ul className="divide-y divide-stone-200 text-sm">
              {top.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-3 py-2">
                  <span className="w-5 text-xs text-stone-500">{i + 1}</span>
                  <Link href={`/products/${p.productId}`} className="flex-1 hover:underline truncate">{p.title}</Link>
                  <span className="w-16 text-right text-xs text-stone-500">{p.unitsSold} u</span>
                  <span className="w-24 text-right font-medium">{formatPrice(p.revenueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <PostHogCard data={posthog} />
      <LiveSessionsCard />
    </section>
  );
}

function LiveSessionsCard() {
  const [data, setData] = useState<SessionsByCountry | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Poll every 30 seconds so the "now" window stays fresh without
  // hammering the API. When the tab isn't visible we skip — no point
  // burning bandwidth for a dashboard nobody's looking at.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (document.visibilityState !== 'visible') return;
      try {
        const d = await api<SessionsByCountry>('/api/admin/analytics/sessions-by-country?minutes=5');
        if (!cancelled) { setData(d); setErr(null); }
      } catch (e) {
        if (!cancelled) setErr(e instanceof ApiError ? e.message : 'Load failed');
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const max = Math.max(1, ...(data?.items ?? []).map((i) => i.sessions));

  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Live sessions by country</h2>
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          last 5 min · {data?.totalSessions ?? 0} active
        </div>
      </div>
      {err && <div className="text-xs text-red-700 mb-2">{err}</div>}
      {!data || data.items.length === 0 ? (
        <p className="text-sm text-stone-500">
          No active sessions right now.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {data.items.map((i) => {
            const pct = (i.sessions / max) * 100;
            return (
              <li key={i.country} className="flex items-center gap-3">
                <span className="w-10 text-lg leading-none">{flagFor(i.country)}</span>
                <span className="w-12 font-mono text-xs text-stone-500">{i.country}</span>
                <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
                  <div className="h-full bg-stone-900" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-xs">{i.sessions}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Flag emoji from a 2-letter country code via regional indicators.
// Returns the raw code for the "unknown" bucket ("??").
function flagFor(country: string): string {
  if (country.length !== 2 || country === '??') return '🏳️';
  const A = 'A'.charCodeAt(0);
  const offset = 127397;
  const a = country.charCodeAt(0);
  const b = country.charCodeAt(1);
  if (a < A || a > A + 25 || b < A || b > A + 25) return country;
  try { return String.fromCodePoint(a + offset, b + offset); } catch { return country; }
}

function PostHogCard({ data }: { data: PostHog | null }) {
  if (!data) return null;
  if (!data.configured) {
    return (
      <div className="card card-pad mb-4 border-dashed">
        <h2 className="text-sm font-semibold mb-1">PostHog</h2>
        <p className="text-sm text-stone-500">
          Not connected. Set <code className="font-mono bg-gray-100 px-1">POSTHOG_API_KEY</code> and{' '}
          <code className="font-mono bg-gray-100 px-1">POSTHOG_PROJECT_ID</code> in the backend env,
          then restart the API.
        </p>
      </div>
    );
  }
  return (
    <div className="card card-pad mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">PostHog</h2>
        {data.dashboardUrl && (
          <a href={data.dashboardUrl} target="_blank" rel="noreferrer" className="text-xs hover:underline">
            Open in PostHog →
          </a>
        )}
      </div>
      {data.error && (
        <div className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          {data.error}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3 mb-4 text-sm">
        <div>
          <div className="text-xs text-stone-500">Unique visitors</div>
          <div className="text-lg font-semibold">{data.uniqueVisitors.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-stone-500">Pageviews</div>
          <div className="text-lg font-semibold">{data.pageviews.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-stone-500">Total events</div>
          <div className="text-lg font-semibold">{data.totalEvents.toLocaleString()}</div>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Top events</h3>
          {data.topEvents.length === 0 ? (
            <p className="text-xs text-stone-500">—</p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {data.topEvents.map((e) => (
                <li key={e.event} className="flex justify-between py-1">
                  <span className="font-mono text-xs">{e.event}</span>
                  <span className="text-xs">{e.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wide mb-1">Top pages</h3>
          {data.topPages.length === 0 ? (
            <p className="text-xs text-stone-500">—</p>
          ) : (
            <ul className="divide-y divide-stone-200">
              {data.topPages.map((p) => (
                <li key={p.path} className="flex justify-between py-1">
                  <span className="truncate pr-2">{p.path}</span>
                  <span className="text-xs shrink-0">{p.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card-pad rounded-xl border border-stone-200 bg-white p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
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
              <span className="text-stone-500">
                {s.count.toLocaleString()}
                {conv !== null && ` · ${conv.toFixed(1)}% of prior`}
              </span>
            </div>
            <div className="h-2 rounded bg-gray-100 overflow-hidden">
              <div className="h-full bg-stone-900" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
