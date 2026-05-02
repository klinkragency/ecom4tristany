// admin/app/(dash)/segments/_forms/shared/MembersPreview.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { persistableRules, type SegmentPayload } from './types';

const PREVIEW_LIMIT = 8;

type Member = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  orderCount: number;
  totalSpentCents: number;
};

type PreviewResponse = {
  items: Member[];
  total: number;
};

// Sticky right-rail card. Debounced (500 ms) POST to
// /api/admin/segments/preview as the user edits rules. Shows total match
// count + first 8 customers. Loading skeleton while fetching, dedicated
// empty/no-conditions state when there's nothing valid to query.
export function MembersPreview({ values }: { values: SegmentPayload }) {
  const [items, setItems] = useState<Member[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track whether we've ever fetched at all — lets us distinguish "first
  // mount, nothing yet" from "fetched and got zero matches".
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const valid = persistableRules(values.rules);
    if (valid.length === 0) {
      // Skip the network round-trip when there's nothing to query — the
      // backend would just return everyone, which is misleading.
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const r = await api<PreviewResponse>('/api/admin/segments/preview', {
          method: 'POST',
          body: JSON.stringify({
            name: values.name || 'preview',
            description: values.description,
            matchAll: values.matchAll,
            rules: valid.map((rule, i) => ({
              field: rule.field,
              operator: rule.operator,
              value: rule.value,
              position: i,
            })),
          }),
        });
        setItems((r.items ?? []).slice(0, PREVIEW_LIMIT));
        setTotal(r.total ?? 0);
        setTouched(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Preview failed');
        setItems([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.matchAll, JSON.stringify(values.rules)]);

  const validCount = persistableRules(values.rules).length;

  return (
    <Card title="Members preview">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-stone-500">Matching customers</span>
          {loading ? (
            <span className="inline-block h-5 w-12 animate-pulse rounded bg-stone-200" />
          ) : (
            <span className="text-lg font-semibold tabular-nums text-stone-900">
              {total}
            </span>
          )}
        </div>

        {error && (
          <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-3 space-y-1.5">
          {validCount === 0 ? (
            <div className="rounded border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-500">
              No conditions yet — add one to preview matches.
            </div>
          ) : loading && !touched ? (
            // First-mount skeleton — three placeholder rows.
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-9 animate-pulse rounded bg-stone-100"
                />
              ))}
            </>
          ) : items.length === 0 ? (
            <div className="rounded border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-500">
              No customers match these conditions yet.
            </div>
          ) : (
            <>
              {items.map((m) => {
                const fullName = [m.firstName, m.lastName]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <Link
                    key={m.id}
                    href={`/customers/${m.id}`}
                    className="block rounded border border-stone-200 bg-white px-2.5 py-1.5 hover:border-stone-300 hover:bg-stone-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-stone-900">
                          {m.email || '(no email)'}
                        </div>
                        {fullName && (
                          <div className="truncate text-xs text-stone-500">
                            {fullName}
                          </div>
                        )}
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">
                        {m.orderCount} {m.orderCount === 1 ? 'ord' : 'ords'}
                      </span>
                    </div>
                  </Link>
                );
              })}
              {total > items.length && (
                <p className="pt-1 text-center text-[11px] text-stone-500">
                  Showing {items.length} of {total} matches.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
