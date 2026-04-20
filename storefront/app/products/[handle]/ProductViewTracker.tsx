'use client';

import { useEffect } from 'react';
import { track } from '@/lib/analytics';

// Fires a single product_view event when the PDP renders. Runs once per
// product ID — React Strict Mode's double-mount in dev gets around by
// tracking the last-seen ID in a module-level set, so the event isn't
// emitted twice when the component mounts-unmounts-remounts.
const seen = new Set<string>();

export default function ProductViewTracker({ productId }: { productId: string }) {
  useEffect(() => {
    if (!productId || seen.has(productId)) return;
    seen.add(productId);
    track('product_view', { productId });
  }, [productId]);
  return null;
}
