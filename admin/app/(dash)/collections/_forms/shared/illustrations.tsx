// admin/app/(dash)/collections/_forms/shared/illustrations.tsx
import { type SVGProps } from 'react';

// 120×120 SVGs using currentColor + a muted secondary fill (opacity 0.3).
// Style consistent with the discount illustrations.
const baseProps = {
  width: 120,
  height: 120,
  viewBox: '0 0 120 120',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
};

// Manual collection — a hand visibly placing a card into a stack.
export function ManualCollectionIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      {/* stack of product cards */}
      <rect x="20" y="60" width="50" height="38" rx="4" fill="currentColor" opacity="0.18" />
      <rect x="26" y="52" width="50" height="38" rx="4" fill="currentColor" opacity="0.32" />
      <rect x="32" y="44" width="50" height="38" rx="4" fill="currentColor" />
      <circle cx="48" cy="60" r="5" fill="white" opacity="0.9" />
      <path d="M40 72h34" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      {/* hand placing top card */}
      <path
        d="M82 30 q4 -6 10 -4 q3 1 4 5 l2 12 q1 6 -4 9 l-12 7 q-7 4 -13 -1 l-9 -7"
        fill="currentColor"
        opacity="0.7"
      />
      <path d="M82 30 l0 16" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Smart collection — a magnet/funnel pulling product chips into a bucket.
export function SmartCollectionIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      {/* funnel */}
      <path
        d="M22 24 L98 24 L70 58 L70 92 L50 100 L50 58 Z"
        fill="currentColor"
        opacity="0.18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* incoming product chips */}
      <rect x="14" y="14" width="14" height="14" rx="2" fill="currentColor" />
      <rect x="34" y="6" width="14" height="14" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="56" y="10" width="14" height="14" rx="2" fill="currentColor" opacity="0.7" />
      <rect x="78" y="6" width="14" height="14" rx="2" fill="currentColor" opacity="0.4" />
      <rect x="98" y="14" width="14" height="14" rx="2" fill="currentColor" opacity="0.6" />
      {/* spark — auto magic */}
      <path
        d="M88 76 l3 -8 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 z"
        fill="currentColor"
      />
    </svg>
  );
}

export type CollectionIllustrationKey = 'manual' | 'smart';

export function illustrationFor(key: CollectionIllustrationKey) {
  switch (key) {
    case 'manual': return ManualCollectionIllustration;
    case 'smart': return SmartCollectionIllustration;
  }
}
