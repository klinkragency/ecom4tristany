import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import SafeHtml from '@/app/products/[handle]/SafeHtml';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  authorName: string;
  featuredImageUrl: string;
  metaDescription: string;
  publishedAt?: string | null;
  tags: string[];
};

export const dynamic = 'force-dynamic';

async function getPost(slug: string): Promise<Post | null> {
  const res = await fetch(`${API}/api/storefront/blog/${encodeURIComponent(slug)}`, {
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`failed to load post (${res.status})`);
  return res.json();
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getPost(slug).catch(() => null);
  if (!p) return { title: 'Post not found' };
  return {
    title: p.title,
    description: p.metaDescription || p.excerpt || undefined,
    openGraph: p.featuredImageUrl ? { images: [p.featuredImageUrl] } : undefined,
  };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <div className="text-sm text-[color:var(--color-text-muted)] mb-2">
        <Link href="/blog" className="hover:underline">← Blog</Link>
      </div>
      <h1 className="text-3xl font-semibold mb-3">{post.title}</h1>
      <div className="text-xs text-[color:var(--color-text-muted)] mb-6">
        {post.publishedAt && new Date(post.publishedAt).toLocaleDateString()}
        {post.authorName && <span> · {post.authorName}</span>}
      </div>
      {post.featuredImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.featuredImageUrl} alt="" className="w-full rounded mb-6" />
      )}
      {post.contentHtml && <SafeHtml html={post.contentHtml} className="prose max-w-none text-sm" />}
      {post.tags.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-1">
          {post.tags.map((t) => (
            <span key={t} className="text-xs rounded bg-gray-100 px-2 py-1 text-[color:var(--color-text-muted)]">#{t}</span>
          ))}
        </div>
      )}
    </article>
  );
}
