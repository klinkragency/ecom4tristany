import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Single-shop ecommerce storefront',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-[color:var(--color-border)]">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
            <Link href="/" className="text-lg font-semibold">Shop</Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/products" className="hover:underline">Products</Link>
              <Link href="/collections" className="hover:underline">Collections</Link>
              <Link href="/account" className="hover:underline">Account</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[color:var(--color-border)] text-sm text-[color:var(--color-text-muted)]">
          <div className="mx-auto max-w-6xl px-4 py-6">© Shop — Phase 1 shell</div>
        </footer>
      </body>
    </html>
  );
}
