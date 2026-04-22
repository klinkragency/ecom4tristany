'use client';

import { useEffect, useState } from 'react';
import { useCurrency } from './CurrencyProvider';
import { COOKIE as CURRENCY_COOKIE } from '@/lib/currency';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const DISMISS_COOKIE = 'geo_hint_dismissed';

type Hint = {
  country: string;
  suggestedCurrency: string;
};

// First-visit currency suggestion banner. Hits the backend once — if it
// detects a country + the shop has that country's currency configured AND
// the visitor hasn't already picked one (or dismissed the hint), we show
// a dismissable bar asking "switch to X?".
export default function GeoHint() {
  const { currency, currencies, setCurrency } = useCurrency();
  const [hint, setHint] = useState<Hint | null>(null);

  useEffect(() => {
    // Never prompt if the buyer has already made a choice, already
    // dismissed, or there's only one currency configured.
    if (hasCookie(CURRENCY_COOKIE) || hasCookie(DISMISS_COOKIE) || currencies.length < 2) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/storefront/geo-hint`, { credentials: 'include' });
        if (!r.ok) return;
        const body: Hint = await r.json();
        // Only meaningful if we detected a country, the shop has that
        // currency active, AND it differs from what we're currently showing.
        const active = currencies.find((c) => c.code === body.suggestedCurrency);
        if (cancelled || !active || active.code === currency.code) return;
        setHint(body);
      } catch { /* swallow — never break page load on a hint */ }
    })();
    return () => { cancelled = true; };
  }, [currencies, currency]);

  if (!hint) return null;

  function accept() {
    if (!hint) return;
    setCurrency(hint.suggestedCurrency);
    // CurrencyProvider writes the cookie + reloads; no further work here.
  }
  function dismiss() {
    // 90-day cool-down so we don't nag daily visitors who prefer the base.
    document.cookie = `${DISMISS_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 90}; samesite=lax`;
    setHint(null);
  }

  const flag = flagFor(hint.country);
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm">
      <div className="mx-auto max-w-6xl px-4 py-2 flex items-center gap-3">
        <span>{flag}</span>
        <span className="flex-1">
          You&rsquo;re browsing from <b>{hint.country}</b>. Would you like prices in{' '}
          <b>{hint.suggestedCurrency}</b>?
        </span>
        <button
          onClick={accept}
          className="px-3 py-1 rounded bg-amber-900 text-amber-50 text-xs hover:bg-amber-800"
        >
          Switch to {hint.suggestedCurrency}
        </button>
        <button
          onClick={dismiss}
          className="text-xs hover:underline"
          aria-label="Dismiss"
        >
          No thanks
        </button>
      </div>
    </div>
  );
}

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') return false;
  return new RegExp('(^|;\\s*)' + name + '=').test(document.cookie);
}

// Quick flag emoji lookup — regional indicator symbols are A-Z + 127397.
// Falls back to the two-letter code inside a badge when regional indicator
// rendering isn't available (most terminals / odd fonts).
function flagFor(country: string): string {
  if (country.length !== 2) return '';
  const A = 'A'.charCodeAt(0);
  const offset = 127397;
  const chars = [country.charCodeAt(0) - A + offset + A, country.charCodeAt(1) - A + offset + A];
  try { return String.fromCodePoint(...chars); } catch { return country; }
}
