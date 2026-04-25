// Currency helpers. Prices are stored server-side in the shop's BASE currency
// (always EUR in the MVP). We convert + format at display time to whatever
// the buyer picked via the CurrencySwitcher.
//
// These are pure functions — they don't touch React state directly. The
// CurrencyProvider is the client-side glue that reads the cookie and feeds
// the active currency to usePrice().

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export type Currency = {
  code: string;
  symbol: string;
  symbolPosition: 'before' | 'after';
  decimalPlaces: number;
  exchangeRate: number; // number of {code} units per 1 base unit
  active: boolean;
  isBase: boolean;
};

export const COOKIE = 'pref_currency';

// fallbackCurrency is used when nothing else is available — the list fetch
// hasn't resolved yet, or the API is offline. Keeps prices visible even
// when currency configuration is broken.
export const fallbackCurrency: Currency = {
  code: 'EUR',
  symbol: '€',
  symbolPosition: 'after',
  decimalPlaces: 2,
  exchangeRate: 1,
  active: true,
  isBase: true,
};

// fetchCurrencies pulls the active storefront list. Server-safe: called
// from the root layout (Server Component) so the switcher SSRs with real
// options. Cached for 5 minutes; admins can call revalidateTag('currencies')
// to push changes immediately.
export async function fetchCurrencies(): Promise<Currency[]> {
  try {
    const r = await fetch(`${API}/api/storefront/currencies`, {
      next: { revalidate: 300, tags: ['currencies'] },
    });
    if (!r.ok) return [fallbackCurrency];
    const data: { items: Currency[] } = await r.json();
    return data.items?.length > 0 ? data.items : [fallbackCurrency];
  } catch {
    return [fallbackCurrency];
  }
}

// convert turns a base-currency cents amount into the display-currency
// cents amount. Decimal rounding matches the currency's decimal_places.
export function convert(cents: number, target: Currency): number {
  const base = cents / 100;
  const inTarget = base * target.exchangeRate;
  const multiplier = Math.pow(10, target.decimalPlaces);
  return Math.round(inTarget * multiplier) / multiplier;
}

// formatCurrency applies the symbol + position + decimal places rules.
// We deliberately sidestep Intl.NumberFormat here so custom symbols (e.g.
// "CHF ") and positions behave consistently across browsers/locales.
export function formatCurrency(amount: number, c: Currency): string {
  const fixed = amount.toFixed(c.decimalPlaces);
  // Insert a thin-space thousand separator. Works across locales.
  const [intPart, decPart] = fixed.split('.');
  const grouped = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F');
  const body = decPart ? `${grouped},${decPart}` : grouped;
  return c.symbolPosition === 'before' ? `${c.symbol}${body}` : `${body}\u00A0${c.symbol}`;
}

// price is the one-shot helper the UI wants: cents → formatted string in
// the chosen currency. The caller passes the currency it already resolved
// (via useCurrency() in client components, resolveCurrency() for servers).
export function price(cents: number, c: Currency = fallbackCurrency): string {
  return formatCurrency(convert(cents, c), c);
}

// resolveCurrency picks the active currency from a cookie value (or null)
// against a list. Shared between the Provider (hydration) and Server
// Components. Pure — no React, no cookie reading.
export function resolveCurrency(currencies: Currency[], cookieVal: string | null): Currency {
  if (cookieVal) {
    const match = currencies.find((c) => c.code === cookieVal);
    if (match) return match;
  }
  return currencies.find((c) => c.isBase) ?? currencies[0] ?? fallbackCurrency;
}
