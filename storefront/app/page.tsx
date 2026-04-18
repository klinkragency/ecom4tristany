import Link from 'next/link';

export default function Home() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="text-3xl font-semibold mb-2">Welcome</h1>
      <p className="text-[color:var(--color-text-muted)] max-w-prose mb-6">
        This is a Phase&nbsp;1 storefront shell. Catalog, cart, and checkout arrive in
        Phase&nbsp;2 and Phase&nbsp;3 respectively.
      </p>
      <div className="flex gap-3 text-sm">
        <Link
          href="/account/register"
          className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
        >
          Create an account
        </Link>
        <Link
          href="/account/login"
          className="px-3 py-2 rounded border border-[color:var(--color-border)]"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
