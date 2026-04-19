'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cart-store';

export default function CartLink() {
  const { cart } = useCart();
  const qty = cart?.totalQuantity ?? 0;
  return (
    <Link href="/cart" className="hover:underline inline-flex items-center gap-1">
      Cart
      {qty > 0 && (
        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-[color:var(--color-accent)] text-white text-xs">
          {qty}
        </span>
      )}
    </Link>
  );
}
