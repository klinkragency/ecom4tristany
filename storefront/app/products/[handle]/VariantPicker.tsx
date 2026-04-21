'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addToCart, ApiError } from '@/lib/cart';
import { cartStore } from '@/lib/cart-store';
import { track } from '@/lib/analytics';
import { type Product, type ProductVariant } from '@/lib/types';
import { Price } from '@/components/CurrencyProvider';

export default function VariantPicker({ product }: { product: Product }) {
  const router = useRouter();
  const initialValues = useMemo<Record<string, string>>(() => {
    const first = product.variants[0];
    return first ? first.optionValues : {};
  }, [product]);
  const [selected, setSelected] = useState<Record<string, string>>(initialValues);
  const [qty, setQty] = useState(1);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variant = useMemo<ProductVariant | undefined>(() => {
    if (product.options.length === 0) return product.variants[0];
    return product.variants.find((v) =>
      product.options.every((o) => v.optionValues[o.id] === selected[o.id]),
    );
  }, [product, selected]);

  async function onAdd() {
    if (!variant) return;
    setAdding(true);
    setError(null);
    try {
      const cart = await addToCart(variant.id, qty);
      cartStore.set({ cart });
      track('cart_add', {
        productId: product.id,
        variantId: variant.id,
        cartId: cart.id,
        payload: { quantity: qty, unitPriceCents: variant.priceCents },
      });
      router.push('/cart');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add to cart');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div>
      <div className="text-2xl font-semibold mb-4">
        {variant ? <Price cents={variant.priceCents} /> : '—'}
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
          onClick={onAdd}
          disabled={adding || !variant}
          className="px-4 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}
