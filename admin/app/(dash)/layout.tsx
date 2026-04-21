import Link from 'next/link';
import LogoutButton from './LogoutButton';
import PasswordChangeGate from './PasswordChangeGate';
import WhoAmI from './WhoAmI';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/orders', label: 'Orders' },
  { href: '/returns', label: 'Returns' },
  { href: '/products', label: 'Products' },
  { href: '/collections', label: 'Collections' },
  { href: '/inventory/transfers', label: 'Transfers' },
  { href: '/locations', label: 'Locations' },
  { href: '/settings/shipping', label: 'Shipping' },
  { href: '/customers', label: 'Customers' },
  { href: '/segments', label: 'Segments' },
  { href: '/discounts', label: 'Discounts' },
  { href: '/content', label: 'Content' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] min-h-screen">
      <PasswordChangeGate />
      <aside className="border-r border-[color:var(--color-border)] bg-white p-4 flex flex-col">
        <div className="font-semibold mb-4 text-sm tracking-wide uppercase">Shop Admin</div>
        <nav className="flex flex-col gap-1 flex-1">
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
        <div className="mt-6 space-y-2">
          <WhoAmI />
          <LogoutButton />
        </div>
      </aside>
      <main className="p-6">{children}</main>
    </div>
  );
}
