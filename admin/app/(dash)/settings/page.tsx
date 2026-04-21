import Link from 'next/link';

const sections = [
  { href: '/settings/general', title: 'General', sub: 'Store name, currency, VAT, public URL' },
  { href: '/settings/users', title: 'Admin users', sub: 'Invite teammates, manage roles' },
  { href: '/settings/audit', title: 'Audit log', sub: 'Every admin action, searchable' },
  { href: '/settings/shipping', title: 'Shipping', sub: 'Zones and rates' },
  { href: '/settings/taxes', title: 'Tax rates', sub: 'VAT per country' },
  { href: '/settings/currencies', title: 'Currencies', sub: 'Active currencies + exchange rates' },
  { href: '/settings/change-password', title: 'Change my password', sub: '' },
];

export default function SettingsPage() {
  return (
    <section className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">Settings</h1>
      <ul className="divide-y divide-[color:var(--color-border)] border border-[color:var(--color-border)] rounded bg-white">
        {sections.map((s) => (
          <li key={s.href}>
            <Link
              href={s.href}
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-sm"
            >
              <div>
                <div className="font-medium">{s.title}</div>
                {s.sub && <div className="text-xs text-[color:var(--color-text-muted)]">{s.sub}</div>}
              </div>
              <span className="text-[color:var(--color-text-muted)]">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
