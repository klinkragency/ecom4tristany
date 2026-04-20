// Client-side analytics tracker. Fires to POST /api/storefront/events —
// fire-and-forget: failures are swallowed so a dead analytics endpoint
// never breaks a page load. The backend enriches with the session cookie,
// IP, user agent, and (if authenticated) customer id.
//
// Usage:
//   import { track, trackPageView } from '@/lib/analytics';
//   track('cart_add', { variantId, quantity });
//
// The autoPageView() helper (wired into the layout) emits `page_view` on
// route changes via a tiny Next.js navigation observer.

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

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

export function trackPageView(): void {
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
