'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('storefront segment error:', error);
  }, [error]);

  return (
    <section className="mx-auto max-w-2xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
      <p className="mb-6 text-sm text-[color:var(--color-text-muted)]">
        We couldn’t load this page. It might be a temporary issue.
      </p>
      <div className="flex justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-bg)]"
        >
          Back home
        </Link>
      </div>
    </section>
  );
}
