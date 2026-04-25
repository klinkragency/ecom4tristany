'use client';

// Last-resort boundary: handles errors in the root layout itself.
// Must render its own <html>/<body> because the app layout can't.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
          Admin failed to load
        </h1>
        <p style={{ color: '#78716c', marginBottom: 12 }}>
          {error.message || 'Unexpected error.'}
        </p>
        <button
          onClick={reset}
          style={{
            background: '#1c1917',
            color: '#fafaf9',
            padding: '8px 14px',
            borderRadius: 10,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
