'use client';

import { useEffect } from 'react';
import { installAutoPageView } from '@/lib/analytics';

// Thin client component the root layout can mount so auto-page-view tracking
// runs without turning the whole layout into a client component.
export default function AnalyticsTracker() {
  useEffect(() => {
    installAutoPageView();
  }, []);
  return null;
}
