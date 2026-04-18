import Link from 'next/link';
import LogoutButton from './LogoutButton';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/orders', label: 'Orders' },
  { href: '/products', label: 'Products' },
  { href: '/collections', label: 'Collections' },
  { href: '/customers', label: 'Customers' },
  { href: '/discounts', label: 'Discounts' },
  { href: '/content', label: 'Content' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] min-h-screen">
      <aside className="border-r border-[color:var(--color-border)] bg-white p-4">
        <div className="font-semibold mb-4 text-sm tracking-wide uppercase">Shop Admin</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-1.5 rounded text-sm hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-6">
          <LogoutButton />
        </div>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
