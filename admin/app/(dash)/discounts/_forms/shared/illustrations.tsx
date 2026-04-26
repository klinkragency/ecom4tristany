// admin/app/(dash)/discounts/_forms/shared/illustrations.tsx
import { type SVGProps } from 'react';

// All illustrations render at 120×120 by default and use currentColor + a
// muted secondary fill (opacity 0.3). Colour cascades via the parent's
// `color: var(--color-illustration)` style.
const baseProps = {
  width: 120,
  height: 120,
  viewBox: '0 0 120 120',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
};

export function AmountOffOrderIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="20" y="22" width="80" height="76" rx="6" fill="currentColor" opacity="0.18" />
      <path d="M28 38h64M28 52h44M28 66h54" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="86" cy="84" r="14" fill="currentColor" />
      <text x="86" y="89" fontSize="13" fontWeight="700" textAnchor="middle" fill="white">%</text>
    </svg>
  );
}

export function AmountOffProductsIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="14" y="32" width="42" height="56" rx="5" fill="currentColor" opacity="0.18" />
      <rect x="64" y="32" width="42" height="56" rx="5" fill="currentColor" opacity="0.32" />
      <circle cx="35" cy="50" r="6" fill="currentColor" />
      <circle cx="85" cy="50" r="6" fill="currentColor" />
      <path d="M22 70h26M72 70h26" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="100" cy="20" r="14" fill="currentColor" />
      <text x="100" y="25" fontSize="11" fontWeight="700" textAnchor="middle" fill="white">-%</text>
    </svg>
  );
}

export function BuyXGetYIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="14" y="34" width="44" height="58" rx="5" fill="currentColor" opacity="0.32" />
      <rect x="62" y="34" width="44" height="58" rx="5" fill="currentColor" opacity="0.18" />
      <path d="M62 22 L84 22 L84 34 L62 34 Z" fill="currentColor" />
      <path d="M22 22 L44 22 L44 34 L22 34 Z" fill="currentColor" />
      <path d="M52 60 l8 -8 l-8 -8 M68 60 l-8 -8 l8 -8" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function FreeShippingIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="10" y="50" width="60" height="36" rx="3" fill="currentColor" opacity="0.18" />
      <rect x="70" y="58" width="34" height="28" rx="3" fill="currentColor" opacity="0.32" />
      <path d="M70 58 l8 -10 l16 0 l10 10" stroke="currentColor" strokeWidth="3" fill="none" />
      <circle cx="30" cy="92" r="8" fill="currentColor" />
      <circle cx="86" cy="92" r="8" fill="currentColor" />
      <path d="M22 38 L8 28 M30 28 L18 18 M40 26 L34 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export type IllustrationKey = 'amount-off-order' | 'amount-off-products' | 'buy-x-get-y' | 'free-shipping';

export function illustrationFor(key: IllustrationKey) {
  switch (key) {
    case 'amount-off-order': return AmountOffOrderIllustration;
    case 'amount-off-products': return AmountOffProductsIllustration;
    case 'buy-x-get-y': return BuyXGetYIllustration;
    case 'free-shipping': return FreeShippingIllustration;
  }
}
