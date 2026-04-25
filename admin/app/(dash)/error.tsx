'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to console in dev. In prod this can route to PostHog.
    // eslint-disable-next-line no-console
    console.error('admin segment error:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <h1 className="h-page mb-2">Something went wrong</h1>
      <p className="mb-4 text-sm text-stone-500">
        {error.message || 'Unexpected error. Try again, or refresh the page.'}
      </p>
      <button onClick={reset} className="btn btn-primary">Try again</button>
    </div>
  );
}
