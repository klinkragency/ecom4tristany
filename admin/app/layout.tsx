import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Shop Admin',
  description: 'Single-shop ecommerce admin',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
