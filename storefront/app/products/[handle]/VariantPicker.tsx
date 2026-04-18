'use client';

import { useMemo, useState } from 'react';
import { formatPrice, type Product, type ProductVariant } from '@/lib/types';

export default function VariantPicker({ product }: { product: Product }) {
  const initialValues = useMemo<Record<string, string>>(() => {
    const first = product.variants[0];
    return first ? first.optionValues : {};
  }, [product]);
  const [selected, setSelected] = useState<Record<string, string>>(initialValues);
  const [qty, setQty] = useState(1);

  const variant = useMemo<ProductVariant | undefined>(() => {
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((v) =>
      product.options.every((o) => v.optionValues[o.id] === selected[o.id]),
    );
  }, [product, selected]);

  return (
    <div>
      <div className="text-2xl font-semibold mb-4">
        {variant ? formatPrice(variant.priceCents) : '—'}
      </div>

      {product.options.map((o) => (
        <div key={o.id} className="mb-4">
          <div className="text-sm font-medium mb-2">{o.name}</div>
          <div className="flex flex-wrap gap-2">
            {o.values.map((v) => {
              const active = selected[o.id] === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => setSelected({ ...selected, [o.id]: v.id })}
                  className={`px-3 py-1.5 text-sm rounded border ${
                    active
                      ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-white'
                      : 'border-[color:var(--color-border)] hover:border-gray-500'
                  }`}
                >
                  {v.value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Qty</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, parseInt(e.target.value || '1', 10)))}
          className="w-20 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
        <button
          disabled
          title="Cart + checkout arrive in Phase 3"
          className="px-4 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50"
        >
          Add to cart (Phase 3)
        </button>
      </div>
    </div>
  );
}
