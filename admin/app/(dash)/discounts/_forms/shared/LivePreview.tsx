// admin/app/(dash)/discounts/_forms/shared/LivePreview.tsx
'use client';

import { Card } from '@/components/ui';
import type { DiscountPayload, TypeURL } from './types';
import { computePreview, SAMPLE_CART, SAMPLE_SHIPPING_CENTS } from './preview-math';
import { formatCents } from './helpers';

function scheduleStatus(v: DiscountPayload): { label: string; color: string } {
  if (!v.active) return { label: '⊘ Inactive', color: 'text-stone-500' };
  const now = new Date();
  if (v.startsAt && new Date(v.startsAt) > now) {
    return { label: `⏰ Starts ${formatDate(v.startsAt)}`, color: 'text-amber-700' };
  }
  if (v.endsAt && new Date(v.endsAt) < now) {
    return { label: '⏰ Expired', color: 'text-red-600' };
  }
  return { label: '✓ Active', color: 'text-green-700' };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function LivePreview({
  values,
  type,
}: {
  values: DiscountPayload;
  type: TypeURL;
}) {
  const r = computePreview(values, type);
  const status = scheduleStatus(values);
  const codeBadge = values.code
    ? values.code
    : values.title
    ? 'Automatic'
    : 'Code required';

  return (
    <Card title="Customer view">
      <div className="flex items-center justify-between text-xs">
        <span className="rounded bg-stone-900 px-2 py-1 font-mono text-white">{codeBadge}</span>
        <span className={status.color}>{status.label}</span>
      </div>

      <div className="mt-4 space-y-1 text-sm">
        {SAMPLE_CART.map((it) => {
          const highlighted = r.highlightedProductIds.includes(it.productId);
          return (
            <div
              key={it.productId}
              className={`flex justify-between ${highlighted ? 'text-stone-900 font-medium' : 'text-stone-600'}`}
            >
              <span>
                {it.title} × {it.quantity}
              </span>
              <span className="tabular">€{formatCents(it.unitPriceCents * it.quantity)}</span>
            </div>
          );
        })}
      </div>

      <hr className="my-3 border-stone-200" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-stone-600">
          <span>Subtotal</span>
          <span className="tabular">€{formatCents(r.subtotalCents)}</span>
        </div>
        {r.discountCents > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Promo {values.code || 'Automatic'}</span>
            <span className="tabular">-€{formatCents(r.discountCents)}</span>
          </div>
        )}
        <div className="flex justify-between text-stone-600">
          <span>Shipping</span>
          <span className={`tabular ${r.freeShippingApplied ? 'text-green-700' : ''}`}>
            {r.freeShippingApplied ? <><s>€{formatCents(SAMPLE_SHIPPING_CENTS)}</s> €0.00</> : <>€{formatCents(r.shippingCents)}</>}
          </span>
        </div>
        <div className="flex justify-between font-semibold pt-1 border-t border-stone-200">
          <span>Total</span>
          <span className="tabular">€{formatCents(r.totalCents)}</span>
        </div>
      </div>

      {(values.minSubtotalCents > 0 || values.eligibility === 'segments' || values.startsAt) && (
        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {values.minSubtotalCents > 0 && <div>ℹ️ Min order €{formatCents(values.minSubtotalCents)}</div>}
          {values.eligibility === 'segments' && <div>ℹ️ Restricted to selected segments</div>}
          {values.startsAt && new Date(values.startsAt) > new Date() && <div>⏰ Starts {formatDate(values.startsAt)}</div>}
        </div>
      )}
    </Card>
  );
}
