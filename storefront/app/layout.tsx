import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import CartLink from '@/components/CartLink';
import AnalyticsTracker from '@/components/AnalyticsTracker';
import CurrencyProvider from '@/components/CurrencyProvider';
import CurrencySwitcher from '@/components/CurrencySwitcher';
import { fetchMenu, hrefFor, type MenuItem } from '@/lib/menu';
import { fetchCurrencies, COOKIE as CURRENCY_COOKIE } from '@/lib/currency';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Single-shop ecommerce storefront',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [mainMenu, footerMenu, currencies, cookieStore] = await Promise.all([
    fetchMenu('main'),
    fetchMenu('footer'),
    fetchCurrencies(),
    cookies(),
  ]);
  const currencyCookie = cookieStore.get(CURRENCY_COOKIE)?.value ?? null;

  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <CurrencyProvider currencies={currencies} initialCookie={currencyCookie}>
        <AnalyticsTracker />
        <header className="border-b border-[color:var(--color-border)]">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold">Shop</Link>
            <nav className="flex items-center gap-4 text-sm">
              {mainMenu.items.length > 0 ? (
                mainMenu.items.map((it) => <HeaderLink key={it.id} item={it} />)
              ) : (
                <>
                  <Link href="/products" className="hover:underline">Products</Link>
                  <Link href="/collections" className="hover:underline">Collections</Link>
                </>
              )}
              <CurrencySwitcher />
              <CartLink />
              <Link href="/account" className="hover:underline">Account</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[color:var(--color-border)] text-sm text-[color:var(--color-text-muted)]">
          <div className="mx-auto max-w-6xl px-4 py-8">
            {footerMenu.items.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
                {footerMenu.items.map((col) => (
                  <div key={col.id}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--color-text)] mb-2">
                      {col.label}
                    </div>
                    {col.children && col.children.length > 0 ? (
                      <ul className="space-y-1">
                        {col.children.map((c) => (
                          <li key={c.id}>
                            {c.linkType === 'menu_header' ? (
                              <span className="text-xs">{c.label}</span>
                            ) : (
                              <a
                                href={hrefFor(c)}
                                target={c.openInNewTab ? '_blank' : undefined}
                                rel={c.openInNewTab ? 'noreferrer' : undefined}
                                className="text-xs hover:underline"
                              >
                                {c.label}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : col.linkType !== 'menu_header' ? (
                      <a
                        href={hrefFor(col)}
                        target={col.openInNewTab ? '_blank' : undefined}
                        rel={col.openInNewTab ? 'noreferrer' : undefined}
                        className="text-xs hover:underline"
                      >
                        {col.label}
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            <div>© Shop</div>
          </div>
        </footer>
        </CurrencyProvider>
      </body>
    </html>
  );
}

function HeaderLink({ item }: { item: MenuItem }) {
  if (item.linkType === 'menu_header') {
    return <span className="text-[color:var(--color-text-muted)]">{item.label}</span>;
  }
  return (
    <a
      href={hrefFor(item)}
      target={item.openInNewTab ? '_blank' : undefined}
      rel={item.openInNewTab ? 'noreferrer' : undefined}
      className="hover:underline"
    >
      {item.label}
    </a>
  );
}
