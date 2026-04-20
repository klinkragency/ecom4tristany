import Link from 'next/link';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Post = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  authorName: string;
  featuredImageUrl: string;
  publishedAt?: string | null;
  tags: string[];
};

export const dynamic = 'force-dynamic';

export default async function BlogIndex() {
  const res = await fetch(`${API}/api/storefront/blog?limit=20`, { cache: 'no-store' });
  const data: { items: Post[] } = res.ok ? await res.json() : { items: [] };
  const posts = data.items ?? [];

  return (
    <section className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold mb-6">Blog</h1>
      {posts.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">No posts published yet.</p>
      ) : (
        <ul className="space-y-6">
          {posts.map((p) => (
            <li key={p.id} className="border-b border-[color:var(--color-border)] pb-6">
              <Link href={`/blog/${p.slug}`} className="block group">
                {p.featuredImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.featuredImageUrl} alt="" className="w-full h-48 object-cover rounded mb-3" />
                )}
                <h2 className="text-xl font-semibold group-hover:underline mb-1">{p.title}</h2>
                <div className="text-xs text-[color:var(--color-text-muted)] mb-2">
                  {p.publishedAt && new Date(p.publishedAt).toLocaleDateString()}
                  {p.authorName && <span> · {p.authorName}</span>}
                </div>
                {p.excerpt && <p className="text-sm">{p.excerpt}</p>}
                {p.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span key={t} className="text-xs rounded bg-gray-100 px-2 py-0.5 text-[color:var(--color-text-muted)]">#{t}</span>
                    ))}
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
