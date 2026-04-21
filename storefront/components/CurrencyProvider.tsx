'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Currency } from '@/lib/currency';
import { COOKIE, fallbackCurrency, price as priceFn } from '@/lib/currency';

type Ctx = {
  currency: Currency;
  currencies: Currency[];
  setCurrency: (code: string) => void;
};

const CurrencyCtx = createContext<Ctx | null>(null);

// Root provider. Fed with the list from the server component, picks the
// active currency from the cookie on hydration (or falls back to base),
// and exposes setCurrency() which writes the cookie + triggers a
// client-side reload so SSR pages re-render with the new currency.
export default function CurrencyProvider({
  currencies, initialCookie, children,
}: {
  currencies: Currency[];
  initialCookie: string | null;
  children: React.ReactNode;
}) {
  const base = currencies.find((c) => c.isBase) ?? currencies[0] ?? fallbackCurrency;
  const initial = currencies.find((c) => c.code === initialCookie) ?? base;
  const [current, setCurrent] = useState<Currency>(initial);

  useEffect(() => {
    // Re-resolve on mount in case the server-side cookie read missed (dev
    // HMR, first-render stale props, etc.).
    const cookieVal = readCookie(COOKIE);
    if (cookieVal) {
      const match = currencies.find((c) => c.code === cookieVal);
      if (match && match.code !== current.code) setCurrent(match);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setCurrency(code: string) {
    const match = currencies.find((c) => c.code === code);
    if (!match) return;
    // 1-year cookie; enough for returning visitors to keep their choice.
    document.cookie = `${COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setCurrent(match);
    // Server-rendered pages (product listings, PDP) pulled prices in the
    // old currency — reload to pick up the new one.
    window.location.reload();
  }

  const value = useMemo<Ctx>(() => ({
    currency: current,
    currencies,
    setCurrency,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [current, currencies]);

  return <CurrencyCtx.Provider value={value}>{children}</CurrencyCtx.Provider>;
}

export function useCurrency(): Ctx {
  const v = useContext(CurrencyCtx);
  // When a tree renders outside the provider (shouldn't happen in practice
  // but guards tests/snippets), return a static base-only fallback so
  // formatting still works.
  if (!v) {
    return {
      currency: fallbackCurrency,
      currencies: [fallbackCurrency],
      setCurrency: () => { /* noop */ },
    };
  }
  return v;
}

// usePrice is the convenience hook components use for display. Accepts
// base-currency cents (from the API) and returns the formatted string in
// the currently-selected currency.
export function usePrice(cents: number | null | undefined): string {
  const { currency } = useCurrency();
  if (cents == null) return '';
  return priceFn(cents, currency);
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[2]!) : null;
}
