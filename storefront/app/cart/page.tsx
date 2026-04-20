'use client';

import Link from 'next/link';
import { useState } from 'react';
import { updateItem, removeItem, applyDiscount, removeDiscount, ApiError } from '@/lib/cart';
import { cartStore, useCart } from '@/lib/cart-store';
import { formatPrice } from '@/lib/types';

export default function CartPage() {
  const { cart, loading } = useCart();
  const [error, setError] = useState<string | null>(null);

  async function onQtyChange(itemId: string, qty: number) {
    setError(null);
    try {
      const next = await updateItem(itemId, qty);
      cartStore.set({ cart: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function onRemove(itemId: string) {
    setError(null);
    try {
      const next = await removeItem(itemId);
      cartStore.set({ cart: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    }
  }

  if (loading && !cart) {
    return <section className="mx-auto max-w-4xl px-4 py-10"><p>Loading…</p></section>;
  }

  if (!cart || cart.items.length === 0) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h1 className="text-3xl font-semibold mb-4">Your cart is empty</h1>
        <Link
          href="/products"
          className="inline-block px-4 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
        >
          Browse products
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold mb-6">Your cart</h1>

      {error && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <ul className="divide-y divide-[color:var(--color-border)] border-y border-[color:var(--color-border)]">
        {cart.items.map((it) => (
          <li key={it.id} className="py-4 flex items-center gap-4">
            <div className="w-16 h-16 rounded bg-gray-100 overflow-hidden shrink-0">
              {it.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.imageUrl} alt={it.productTitle} className="w-full h-full object-cover" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Link href={`/products/${it.productHandle}`} className="font-medium hover:underline">
                {it.productTitle}
              </Link>
              {it.variantTitle && (
                <div className="text-sm text-[color:var(--color-text-muted)]">{it.variantTitle}</div>
              )}
              <div className="text-sm text-[color:var(--color-text-muted)]">
                {formatPrice(it.unitPriceCents)} each
                {!it.available && <span className="text-amber-700 ml-2">· unavailable</span>}
              </div>
            </div>
            <input
              type="number"
              min={1}
              value={it.quantity}
              onChange={(e) => onQtyChange(it.id, Math.max(1, parseInt(e.target.value || '1', 10)))}
              className="w-16 px-2 py-1 rounded border border-[color:var(--color-border)] text-right"
            />
            <div className="w-24 text-right font-medium">{formatPrice(it.lineTotalCents)}</div>
            <button
              onClick={() => onRemove(it.id)}
              className="text-sm text-red-700 hover:underline"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex justify-end">
        <div className="w-full max-w-xs text-sm">
          <DiscountCodeField cart={cart} setError={setError} />
          <div className="flex justify-between py-1">
            <span className="text-[color:var(--color-text-muted)]">Subtotal</span>
            <span className="font-medium">{formatPrice(cart.subtotalCents)}</span>
          </div>
          {cart.discountCents > 0 && (
            <div className="flex justify-between py-1 text-green-800">
              <span>{cart.discountTitle || 'Discount'}</span>
              <span>−{formatPrice(cart.discountCents)}</span>
            </div>
          )}
          {cart.freeShipping && (
            <div className="flex justify-between py-1 text-green-800 text-xs">
              <span>Free shipping applied at checkout</span>
              <span>✓</span>
            </div>
          )}
          <div className="text-xs text-[color:var(--color-text-muted)] pb-3">
            Shipping and taxes calculated at checkout.
          </div>
          <Link
            href="/checkout"
            className="block w-full text-center px-4 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
          >
            Checkout — {formatPrice(cart.subtotalCents - cart.discountCents)}
          </Link>
        </div>
      </div>
    </section>
  );
}

function DiscountCodeField({
  cart, setError,
}: {
  cart: { discountCode?: string; discountTitle?: string; discountError?: string };
  setError: (s: string | null) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const hasCode = !!cart.discountCode;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const next = await applyDiscount(code.trim());
      cartStore.set({ cart: next });
      setCode('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Invalid code');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      const next = await removeDiscount();
      cartStore.set({ cart: next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  }

  if (hasCode) {
    return (
      <div className="mb-3 p-3 rounded border border-[color:var(--color-border)] bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs">{cart.discountCode}</span>
          {cart.discountTitle && <span className="text-xs text-[color:var(--color-text-muted)] flex-1">{cart.discountTitle}</span>}
          <button onClick={remove} disabled={busy} className="text-xs text-red-700 hover:underline">Remove</button>
        </div>
        {cart.discountError && (
          <div className="mt-1 text-xs text-red-700">{cart.discountError}</div>
        )}
      </div>
    );
  }
  return (
    <div className="mb-3 flex gap-2">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
        placeholder="Discount code"
        className="flex-1 px-3 py-2 rounded border border-[color:var(--color-border)] text-sm font-mono uppercase"
      />
      <button
        onClick={apply}
        disabled={busy || !code.trim()}
        className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? '…' : 'Apply'}
      </button>
    </div>
  );
}
