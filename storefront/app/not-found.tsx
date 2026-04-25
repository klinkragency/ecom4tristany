import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="mx-auto max-w-2xl px-4 py-20 text-center">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--color-text-muted)]">404</p>
      <h1 className="mb-3 text-3xl font-semibold">Page not found</h1>
      <p className="mb-6 text-sm text-[color:var(--color-text-muted)]">
        The page you’re looking for doesn’t exist or has been moved.
      </p>
      <div className="flex justify-center gap-3">
        <Link
          href="/"
          className="rounded-lg bg-black px-4 py-2 text-sm text-white hover:bg-neutral-800"
        >
          Back home
        </Link>
        <Link
          href="/products"
          className="rounded-lg border border-[color:var(--color-border)] px-4 py-2 text-sm hover:bg-[color:var(--color-bg)]"
        >
          Browse products
        </Link>
      </div>
    </section>
  );
}
