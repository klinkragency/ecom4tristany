import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { MetaFieldView, type FieldDef } from './MetaFieldView';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Entry = {
  id: string;
  handle: string;
  name: string;
  fields: Record<string, unknown>;
  publishedAt?: string;
};

type ListResp = {
  items: Entry[];
  type: { handle: string; name: string; description: string; fieldDefs: FieldDef[] };
};

export const dynamic = 'force-dynamic';

async function getList(typeHandle: string): Promise<ListResp | null> {
  const r = await fetch(
    `${API}/api/storefront/metaobjects/${encodeURIComponent(typeHandle)}`,
    { cache: 'no-store' },
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`failed to load (${r.status})`);
  return r.json();
}

export async function generateMetadata(
  { params }: { params: Promise<{ typeHandle: string }> },
): Promise<Metadata> {
  const { typeHandle } = await params;
  const list = await getList(typeHandle).catch(() => null);
  if (!list) return { title: 'Not found' };
  return {
    title: list.type.name,
    description: list.type.description || undefined,
  };
}

export default async function MetaobjectListPage(
  { params }: { params: Promise<{ typeHandle: string }> },
) {
  const { typeHandle } = await params;
  const list = await getList(typeHandle);
  if (!list) notFound();

  const { type, items } = list;
  const primary = type.fieldDefs[0];

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">{type.name}</h1>
        {type.description && (
          <p className="mt-2 text-sm text-[color:var(--color-text-muted)]">{type.description}</p>
        )}
      </header>

      {items.length === 0 ? (
        <p className="text-sm text-[color:var(--color-text-muted)]">Nothing published yet.</p>
      ) : (
        <ul className="divide-y divide-black/10">
          {items.map((e) => (
            <li key={e.id} className="py-5">
              <Link
                href={`/content/${encodeURIComponent(type.handle)}/${encodeURIComponent(e.handle)}`}
                className="block group"
              >
                <h2 className="text-lg font-medium group-hover:underline">{e.name}</h2>
                {primary && primary.type !== 'rich_text' && e.fields[primary.key] != null && (
                  <div className="mt-1 text-sm text-[color:var(--color-text-muted)] line-clamp-2">
                    <MetaFieldView def={primary} value={e.fields[primary.key]} />
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
