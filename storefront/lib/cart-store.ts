'use client';

/**
 * Tiny global cart state. We could use Zustand or context, but this keeps a
 * single module-scope listener list + subscribe() so any component can call
 * cartStore.subscribe to re-render when the cart changes. Initial hydration
 * happens on the client; SSR treats the cart as empty until mounted.
 */

import { useEffect, useState } from 'react';
import { getCart } from './cart';
import type { Cart } from './types';

type State = { cart: Cart | null; loading: boolean };
let state: State = { cart: null, loading: false };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((cb) => cb());
}

export const cartStore = {
  get: () => state,
  set: (next: Partial<State>) => set({ ...state, ...next }),
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  async refresh(): Promise<void> {
    set({ ...state, loading: true });
    try {
      const cart = await getCart();
      set({ cart, loading: false });
    } catch {
      set({ cart: null, loading: false });
    }
  },
};

export function useCart(): State {
  const [snap, setSnap] = useState<State>(state);
  useEffect(() => {
    const unsub = cartStore.subscribe(() => setSnap(cartStore.get()));
    // Kick off an initial fetch on first mount.
    if (!state.cart && !state.loading) void cartStore.refresh();
    return () => { unsub(); };
  }, []);
  return snap;
}
