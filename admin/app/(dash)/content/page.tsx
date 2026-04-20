import Link from 'next/link';

const sections = [
  { href: '/content/pages', title: 'Pages', sub: 'About, FAQ, legal…' },
  { href: '/content/menus', title: 'Navigation menus', sub: 'Header and footer links' },
  { href: '/content/blog', title: 'Blog', sub: 'Posts, tags, RSS' },
];

export default function ContentPage() {
  return (
    <section className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">Content</h1>
      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-sm"
            >
              <div>
                <div className="font-medium">{s.title}</div>
                <div className="text-xs text-[color:var(--color-text-muted)]">{s.sub}</div>
              </div>
              <span className="text-[color:var(--color-text-muted)]">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
