// admin/app/(dash)/collections/_forms/shared/LivePreview.tsx
'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type CollectionProductRef, type ProductListItem, type ProductListPage } from '@/lib/types';
import type { CollectionPayload, RuleInput } from './types';

// Storefront-style mock of the collection page. Renders:
//   - the collection title (or "Untitled collection")
//   - the description as plain text (preview only — production storefront
//     re-sanitizes the HTML with DOMPurify before rendering)
//   - a 6-product grid (image + title + price)
//
// For Manual collections, products come from the local productIds list.
// For Smart collections, we POST to /api/admin/collections/preview with
// a 500ms debounce as the rules change.

const PREVIEW_LIMIT = 6;

// Strip HTML tags and decode common entities for the preview pane. We
// keep the original HTML in state untouched — this is purely for display
// in this small tile so we don't have to render arbitrary HTML here.
function htmlToText(html: string): string {
  if (!html) return '';
  const stripped = html.replace(/<[^>]+>/g, ' ');
  const decoded = stripped
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return decoded.replace(/\s+/g, ' ').trim();
}

export function LivePreview({
  values,
  type,
}: {
  values: CollectionPayload;
  type: 'manual' | 'smart';
}) {
  const [products, setProducts] = useState<CollectionProductRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual: keep a small cache of {id -> product meta} fetched once and
  // reused as the selection changes. Cheap (one /products page) and avoids
  // a per-id round-trip.
  const [productCache, setProductCache] = useState<Record<string, ProductListItem>>({});

  // Manual mode: load product metadata for selected ids.
  useEffect(() => {
    if (type !== 'manual') return;
    const missing = values.productIds.filter((id) => !productCache[id]);
    if (missing.length === 0) {
      setProducts(
        values.productIds
          .slice(0, PREVIEW_LIMIT)
          .map((id) => productCache[id])
          .filter((p): p is ProductListItem => Boolean(p))
          .map(toRef),
      );
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api<ProductListPage>(`/api/admin/products?limit=200`);
        if (cancelled) return;
        const next = { ...productCache };
        for (const it of data.items) next[it.id] = it;
        setProductCache(next);
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, values.productIds.join(',')]);

  // Smart mode: debounced preview against the backend.
  useEffect(() => {
    if (type !== 'smart') return;
    const validRules = collectValidRules(values.rules);
    if (validRules.length === 0) {
      setProducts([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const r = await api<{ items: CollectionProductRef[] }>(
          '/api/admin/collections/preview',
          {
            method: 'POST',
            body: JSON.stringify({
              rules: validRules,
              matchAll: values.matchAll,
              sortOrder: values.sortOrder,
              limit: PREVIEW_LIMIT,
            }),
          },
        );
        setProducts(r.items ?? []);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Preview failed');
        setProducts([]);
      } finally {
        setLoading(false);
      }
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    values.matchAll,
    values.sortOrder,
    JSON.stringify(values.rules),
  ]);

  const title = values.title || 'Untitled collection';
  const matchedCount = products.length;
  const descriptionText = htmlToText(values.descriptionHtml);

  return (
    <Card title="Storefront preview">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
        <h3 className="text-base font-semibold text-stone-900">{title}</h3>
        {descriptionText && (
          <p className="mt-1 text-xs text-stone-600 line-clamp-3">
            {descriptionText}
          </p>
        )}

        <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
          <span>
            {type === 'smart' ? (
              loading ? (
                'Matching…'
              ) : (
                <>
                  <span className="tabular-nums font-semibold text-stone-900">
                    {matchedCount}
                  </span>{' '}
                  matching {matchedCount === 1 ? 'product' : 'products'}
                </>
              )
            ) : (
              <>
                <span className="tabular-nums font-semibold text-stone-900">
                  {values.productIds.length}
                </span>{' '}
                {values.productIds.length === 1 ? 'product' : 'products'}
              </>
            )}
          </span>
        </div>

        {error && (
          <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2">
          {products.length === 0 ? (
            <div className="col-span-2 rounded border border-dashed border-stone-300 px-3 py-6 text-center text-xs text-stone-500">
              {type === 'smart'
                ? 'No products match these conditions yet.'
                : 'No products yet — add some to see them here.'}
            </div>
          ) : (
            products.map((p) => (
              <div
                key={p.id}
                className="overflow-hidden rounded-lg border border-stone-200 bg-white"
              >
                <div className="aspect-square bg-stone-100">
                  {p.primaryImageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.primaryImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="p-2">
                  <div className="truncate text-xs font-medium text-stone-900">
                    {p.title}
                  </div>
                  <div className="text-xs text-stone-500">
                    {p.minPriceCents === p.maxPriceCents
                      ? formatPrice(p.minPriceCents)
                      : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}

// Drop rules where the operator needs a value but the value is blank — the
// backend would reject them, and we'd rather render an empty preview than
// flash an error every keystroke.
function collectValidRules(rules: RuleInput[]): RuleInput[] {
  return rules.filter((r) => {
    if (r.operator === 'in_stock' || r.operator === 'out_of_stock') return true;
    return r.value.trim().length > 0;
  });
}

function toRef(p: ProductListItem): CollectionProductRef {
  return {
    id: p.id,
    handle: p.handle,
    title: p.title,
    status: p.status,
    minPriceCents: p.minPriceCents,
    maxPriceCents: p.maxPriceCents,
    primaryImageUrl: p.primaryImageUrl,
    position: 0,
  };
}
