import Link from 'next/link';
import { cookies } from 'next/headers';
import { type ProductListPage } from '@/lib/types';
import { fetchCurrencies, resolveCurrency, price, COOKIE as CURRENCY_COOKIE } from '@/lib/currency';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export const dynamic = 'force-dynamic';

async function getProducts(): Promise<ProductListPage> {
  const res = await fetch(`${API}/api/storefront/products?limit=50`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`failed to load products (${res.status})`);
  return res.json();
}

export default async function ProductsPage() {
  const [page, currencies, cookieStore] = await Promise.all([
    getProducts(),
    fetchCurrencies(),
    cookies(),
  ]);
  const currency = resolveCurrency(currencies, cookieStore.get(CURRENCY_COOKIE)?.value ?? null);

  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">All products</h1>
      {page.items.length === 0 ? (
        <p className="text-[color:var(--color-text-muted)]">
          No products published yet. Add some from the admin at{' '}
          <a href="http://localhost:3001/products" className="underline">
            /products
          </a>.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
          {page.items.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.handle}`} className="group block">
                <div className="aspect-square w-full rounded bg-gray-100 overflow-hidden mb-2">
                  {p.primaryImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.primaryImageUrl}
                      alt={p.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-xs text-[color:var(--color-text-muted)]">
                      No image
                    </div>
                  )}
                </div>
                <div className="font-medium group-hover:underline">{p.title}</div>
                <div className="text-sm text-[color:var(--color-text-muted)]">
                  {p.minPriceCents === p.maxPriceCents
                    ? price(p.minPriceCents, currency)
                    : `From ${price(p.minPriceCents, currency)}`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
