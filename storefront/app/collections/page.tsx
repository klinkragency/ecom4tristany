import Link from 'next/link';
import type { CollectionListPage } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export const dynamic = 'force-dynamic';

async function getCollections(): Promise<CollectionListPage> {
  const res = await fetch(`${API}/api/storefront/collections?limit=50`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`failed to load collections (${res.status})`);
  return res.json();
}

export default async function CollectionsPage() {
  const page = await getCollections();

  return (
    <section className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold mb-6">Collections</h1>
      {page.items.length === 0 ? (
        <p className="text-[color:var(--color-text-muted)]">No collections yet.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
          {page.items.map((c) => (
            <li key={c.id}>
              <Link href={`/collections/${c.handle}`} className="group block">
                <div className="aspect-[4/3] w-full rounded bg-gray-100 overflow-hidden mb-2">
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt={c.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-sm text-[color:var(--color-text-muted)]">
                      {c.title}
                    </div>
                  )}
                </div>
                <div className="font-medium group-hover:underline">{c.title}</div>
                {!c.isRulesBased && (
                  <div className="text-sm text-[color:var(--color-text-muted)]">
                    {c.productCount} product{c.productCount === 1 ? '' : 's'}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
