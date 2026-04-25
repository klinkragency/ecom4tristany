import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import VariantPicker from './VariantPicker';
import SafeHtml from './SafeHtml';
import ProductViewTracker from './ProductViewTracker';
import type { Product } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

async function getProduct(handle: string): Promise<Product | null> {
  const res = await fetch(`${API}/api/storefront/products/${encodeURIComponent(handle)}`, {
    next: { revalidate: 60, tags: ['products', `product:${handle}`] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`failed to load product (${res.status})`);
  return res.json();
}

export default async function ProductPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const product = await getProduct(handle);
  if (!product) notFound();

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 grid md:grid-cols-2 gap-10">
      <ProductViewTracker productId={product.id} />
      <Gallery product={product} />
      <div>
        <div className="text-sm text-[color:var(--color-text-muted)] mb-1">
          <Link href="/products" className="hover:underline">← All products</Link>
        </div>
        <h1 className="text-3xl font-semibold mb-4">{product.title}</h1>
        <VariantPicker product={product} />
        {product.descriptionHtml && (
          <SafeHtml html={product.descriptionHtml} className="prose max-w-none mt-6 text-sm" />
        )}
        {product.tags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1">
            {product.tags.map((t) => (
              <span
                key={t}
                className="text-xs rounded bg-gray-100 px-2 py-1 text-[color:var(--color-text-muted)]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Gallery({ product }: { product: Product }) {
  const first = product.media[0];
  if (!first) {
    return (
      <div className="aspect-square w-full rounded bg-gray-100 grid place-items-center text-[color:var(--color-text-muted)] text-sm">
        No image
      </div>
    );
  }
  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded bg-gray-100">
        <Image
          src={first.url}
          alt={first.alt || product.title}
          fill
          priority
          sizes="(min-width: 768px) 50vw, 100vw"
          className="object-cover"
        />
      </div>
      {product.media.length > 1 && (
        <div className="mt-2 grid grid-cols-5 gap-2">
          {product.media.slice(0, 5).map((m) => (
            <div key={m.id} className="relative aspect-square w-full overflow-hidden rounded bg-gray-100">
              <Image
                src={m.url}
                alt={m.alt || ''}
                fill
                sizes="(min-width: 768px) 10vw, 20vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
