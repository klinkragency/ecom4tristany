// Client-side analytics tracker. Fires to POST /api/storefront/events
// (our in-house pipeline) AND, if configured, mirrors to PostHog. Both
// pipelines get every event — they're deliberately parallel:
//   - Our backend owns conversion/AOV/revenue reconciliation (coupled to
//     the Postgres orders/refunds ledger).
//   - PostHog is the product-analytics layer: funnels UI, session replay,
//     feature flags, cohort tooling.
//
// PostHog is optional: leave NEXT_PUBLIC_POSTHOG_KEY empty to disable. The
// in-house pipeline is unaffected either way.
//
// Usage:
//   import { track, trackPageView, identify } from '@/lib/analytics';
//   track('cart_add', { variantId, quantity });
//   identify(customerId, { email });

import posthog from 'posthog-js';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
const PH_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
const PH_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

let phInitialised = false;
function ensurePostHog(): typeof posthog | null {
  if (!PH_KEY || typeof window === 'undefined') return null;
  if (!phInitialised) {
    try {
      posthog.init(PH_KEY, {
        api_host: PH_HOST,
        // Next.js App Router: we fire page_view ourselves on client-side
        // navigation, so disable PostHog's automatic capture.
        capture_pageview: false,
        // Autocapture=false lets our explicit track() calls drive analytics;
        // flip to true if you want PostHog's auto click/form tracking.
        autocapture: false,
        persistence: 'localStorage+cookie',
      });
      phInitialised = true;
    } catch {
      // Never break page loads because PostHog init failed.
      return null;
    }
  }
  return posthog;
}

export type EventKind =
  | 'page_view'
  | 'product_view'
  | 'collection_view'
  | 'search'
  | 'cart_add'
  | 'cart_remove'
  | 'cart_update'
  | 'checkout_started'
  | 'checkout_completed';

type EventPayload = Record<string, unknown>;

type TrackOpts = {
  productId?: string;
  variantId?: string;
  cartId?: string;
  orderId?: string;
  payload?: EventPayload;
};

export function track(kind: EventKind, opts: TrackOpts = {}): void {
  if (typeof window === 'undefined') return;

  // 1) Mirror to PostHog (if configured). Fire first so SDK-side
  //    auto-identification runs before any network hop.
  const ph = ensurePostHog();
  if (ph) {
    ph.capture(kind, {
      productId: opts.productId,
      variantId: opts.variantId,
      cartId: opts.cartId,
      orderId: opts.orderId,
      ...opts.payload,
    });
  }

  // 2) In-house pipeline. Body shape matches the Go TrackReq struct exactly.
  const body = JSON.stringify({
    kind,
    productId: opts.productId,
    variantId: opts.variantId,
    cartId: opts.cartId,
    orderId: opts.orderId,
    url: window.location.pathname + window.location.search,
    referrer: document.referrer || undefined,
    payload: opts.payload,
  });
  // Prefer sendBeacon for reliability across unload/visibility transitions,
  // but it can't carry credentials — fall back to fetch.
  try {
    if (navigator.sendBeacon && kind !== 'checkout_completed') {
      const blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon(`${API}/api/storefront/events`, blob);
      return;
    }
  } catch { /* fall through */ }
  void fetch(`${API}/api/storefront/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body,
    keepalive: true,
  }).catch(() => { /* swallow */ });
}

// ─── Identity ───────────────────────────────────────────────────────────

// identify associates the current anonymous session with a known customer
// in PostHog so cohorts / funnels can correlate pre- and post-login activity.
// Call this right after a successful login / register.
export function identify(customerId: string, traits: Record<string, unknown> = {}): void {
  const ph = ensurePostHog();
  if (!ph) return;
  ph.identify(customerId, traits);
}

// reset clears the PostHog identity — call on logout so the next session
// starts anonymous again rather than inheriting the previous user.
export function resetIdentity(): void {
  const ph = ensurePostHog();
  if (!ph) return;
  ph.reset();
}

export function trackPageView(): void {
  // Also fire PostHog's native $pageview — keeps session replay timelines
  // accurate (PostHog associates session events with the latest $pageview).
  const ph = ensurePostHog();
  if (ph) {
    ph.capture('$pageview');
  }
  track('page_view');
}

// autoPageView installs a MutationObserver on <body> plus a popstate
// listener to catch Next.js soft navigations. Called once from the
// root layout client component.
let installed = false;
export function installAutoPageView(): void {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  let lastPath = window.location.pathname + window.location.search;
  const maybeEmit = () => {
    const now = window.location.pathname + window.location.search;
    if (now !== lastPath) {
      lastPath = now;
      trackPageView();
    }
  };
  // Fire the initial page_view.
  trackPageView();
  // popstate covers back/forward.
  window.addEventListener('popstate', maybeEmit);
  // Patch pushState/replaceState to catch programmatic nav (App Router does this).
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = (...args) => {
    const res = origPush(...args);
    queueMicrotask(maybeEmit);
    return res;
  };
  history.replaceState = (...args) => {
    const res = origReplace(...args);
    queueMicrotask(maybeEmit);
    return res;
  };
}
