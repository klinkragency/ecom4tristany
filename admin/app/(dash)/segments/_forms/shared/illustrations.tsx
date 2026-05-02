// admin/app/(dash)/segments/_forms/shared/illustrations.tsx
import { type SVGProps } from 'react';

// 120×120 SVG using currentColor + a muted secondary fill (opacity 0.3).
// Style consistent with the discount/collection illustrations: geometric
// placeholder, recolorable via CSS var --color-illustration.
const baseProps = {
  width: 120,
  height: 120,
  viewBox: '0 0 120 120',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
};

// Segment — a filter funnel grouping people. Three "people" silhouettes
// drop through a funnel into a tighter cluster, suggesting "saved filter
// over your customer list".
export function SegmentIllustration(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...baseProps} {...props}>
      {/* Incoming customer dots — wider distribution at the top */}
      <circle cx="22" cy="18" r="5" fill="currentColor" opacity="0.45" />
      <circle cx="44" cy="10" r="5" fill="currentColor" opacity="0.7" />
      <circle cx="64" cy="14" r="5" fill="currentColor" opacity="0.55" />
      <circle cx="86" cy="10" r="5" fill="currentColor" opacity="0.4" />
      <circle cx="100" cy="20" r="5" fill="currentColor" opacity="0.55" />

      {/* Funnel — tapers toward the bottom, cuts the field into a segment */}
      <path
        d="M14 32 L106 32 L74 64 L74 86 L46 96 L46 64 Z"
        fill="currentColor"
        opacity="0.18"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* Grouped output — a cluster of three "people" heads + shoulders */}
      <g transform="translate(40, 96)">
        <circle cx="6" cy="4" r="4" fill="currentColor" />
        <path
          d="M0 14 q6 -6 12 0"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="20" cy="2" r="4" fill="currentColor" opacity="0.85" />
        <path
          d="M14 12 q6 -6 12 0"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <circle cx="34" cy="4" r="4" fill="currentColor" opacity="0.7" />
        <path
          d="M28 14 q6 -6 12 0"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.7"
        />
      </g>
    </svg>
  );
}
