'use client';

import { useCurrency } from './CurrencyProvider';

// Header-mounted dropdown. Hidden when only one active currency exists —
// the switcher adds visual noise without a reason to exist.
export default function CurrencySwitcher() {
  const { currency, currencies, setCurrency } = useCurrency();
  if (currencies.length <= 1) return null;
  return (
    <select
      value={currency.code}
      onChange={(e) => setCurrency(e.target.value)}
      className="text-xs bg-transparent border border-[color:var(--color-border)] rounded px-1.5 py-0.5 hover:bg-gray-50 cursor-pointer"
      aria-label="Currency"
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.symbol} {c.code}
        </option>
      ))}
    </select>
  );
}
