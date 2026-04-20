import Link from 'next/link';

const sections = [
  { href: '/settings/shipping', title: 'Shipping', sub: 'Zones and rates' },
];

export default function SettingsPage() {
  return (
    <section className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <p className="text-sm text-[color:var(--color-text-muted)] mb-4">
        More sections (store profile, taxes, payments, users, apps) ship in Phase 14.
      </p>
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
