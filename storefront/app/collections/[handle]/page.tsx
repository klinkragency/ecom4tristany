import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import SafeHtml from '../../products/[handle]/SafeHtml';
import { type StorefrontCollection } from '@/lib/types';
import { fetchCurrencies, resolveCurrency, price, COOKIE as CURRENCY_COOKIE } from '@/lib/currency';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

async function getCollection(handle: string): Promise<StorefrontCollection | null> {
  const res = await fetch(`${API}/api/storefront/collections/${encodeURIComponent(handle)}`, {
    next: { revalidate: 60, tags: ['collections', `collection:${handle}`] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`failed to load collection (${res.status})`);
  return res.json();
}

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const [collection, currencies, cookieStore] = await Promise.all([
    getCollection(handle),
    fetchCurrencies(),
    cookies(),
  ]);
  if (!collection) notFound();
  const currency = resolveCurrency(currencies, cookieStore.get(CURRENCY_COOKIE)?.value ?? null);

  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <div className="text-sm text-[color:var(--color-text-muted)] mb-1">
        <Link href="/collections" className="hover:underline">← Collections</Link>
      </div>
      <h1 className="text-3xl font-semibold mb-3">{collection.title}</h1>
      {collection.descriptionHtml && (
        <SafeHtml html={collection.descriptionHtml} className="prose max-w-none mb-6 text-sm" />
      )}

      {collection.products.length === 0 ? (
        <p className="text-[color:var(--color-text-muted)]">No products in this collection.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
          {collection.products.map((p) => (
            <li key={p.id}>
              <Link href={`/products/${p.handle}`} className="group block">
                <div className="relative aspect-square w-full overflow-hidden rounded bg-gray-100 mb-2">
                  {p.primaryImageUrl ? (
                    <Image
                      src={p.primaryImageUrl}
                      alt={p.title}
                      fill
                      sizes="(min-width: 1024px) 220px, (min-width: 640px) 33vw, 50vw"
                      className="object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xs text-[color:var(--color-text-muted)]">
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
