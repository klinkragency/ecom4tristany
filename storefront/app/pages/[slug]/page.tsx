import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import SafeHtml from '@/app/products/[handle]/SafeHtml';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Page = {
  id: string;
  slug: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  metaDescription: string;
  status: 'draft' | 'published';
};

async function getPage(slug: string): Promise<Page | null> {
  const res = await fetch(`${API}/api/storefront/pages/${encodeURIComponent(slug)}`, {
    next: { revalidate: 300, tags: ['pages', `page:${slug}`] },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`failed to load page (${res.status})`);
  return res.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ slug: string }> },
): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPage(slug).catch(() => null);
  if (!p) return { title: 'Page not found' };
  return {
    title: p.title,
    description: p.metaDescription || p.excerpt || undefined,
  };
}

export default async function CMSPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold mb-6">{page.title}</h1>
      {page.contentHtml ? (
        <SafeHtml html={page.contentHtml} className="prose max-w-none text-sm" />
      ) : (
        <p className="text-sm text-[color:var(--color-text-muted)]">This page is empty.</p>
      )}
    </article>
  );
}
