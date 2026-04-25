'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Site failed to load</h1>
        <p style={{ color: '#6b7280', marginBottom: 16 }}>{error.message || 'Unexpected error.'}</p>
        <button
          onClick={reset}
          style={{
            background: '#000',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
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
