import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { MetaFieldRow, type FieldDef } from '../MetaFieldView';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

type Entry = {
  id: string;
  handle: string;
  name: string;
  typeHandle: string;
  fields: Record<string, unknown>;
  publishedAt?: string;
};

type ListResp = {
  items: Entry[];
  type: { handle: string; name: string; description: string; fieldDefs: FieldDef[] };
};

export const dynamic = 'force-dynamic';

async function getEntry(typeHandle: string, entryHandle: string) {
  // Detail endpoint gives us the entry (and 404 on draft/missing). List
  // endpoint gives us the type's fieldDefs so we can render each field
  // the way the admin defined it. Fire both in parallel.
  const [detailRes, listRes] = await Promise.all([
    fetch(
      `${API}/api/storefront/metaobjects/${encodeURIComponent(typeHandle)}/${encodeURIComponent(entryHandle)}`,
      { cache: 'no-store' },
    ),
    fetch(
      `${API}/api/storefront/metaobjects/${encodeURIComponent(typeHandle)}`,
      { cache: 'no-store' },
    ),
  ]);
  if (detailRes.status === 404 || listRes.status === 404) return null;
  if (!detailRes.ok || !listRes.ok) {
    throw new Error(`failed to load (${detailRes.status}/${listRes.status})`);
  }
  const entry: Entry = await detailRes.json();
  const list: ListResp = await listRes.json();
  return { entry, type: list.type };
}

export async function generateMetadata(
  { params }: { params: Promise<{ typeHandle: string; entryHandle: string }> },
): Promise<Metadata> {
  const { typeHandle, entryHandle } = await params;
  const loaded = await getEntry(typeHandle, entryHandle).catch(() => null);
  if (!loaded) return { title: 'Not found' };
  return { title: `${loaded.entry.name} · ${loaded.type.name}` };
}

export default async function MetaobjectEntryPage(
  { params }: { params: Promise<{ typeHandle: string; entryHandle: string }> },
) {
  const { typeHandle, entryHandle } = await params;
  const loaded = await getEntry(typeHandle, entryHandle);
  if (!loaded) notFound();
  const { entry, type } = loaded;

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <nav className="mb-6 text-sm">
        <Link
          href={`/content/${encodeURIComponent(type.handle)}`}
          className="text-[color:var(--color-text-muted)] hover:underline"
        >
          ← {type.name}
        </Link>
      </nav>

      <h1 className="text-3xl font-semibold mb-8">{entry.name}</h1>

      <dl className="space-y-6">
        {type.fieldDefs.map((def) => (
          <MetaFieldRow key={def.key} def={def} value={entry.fields[def.key]} />
        ))}
      </dl>
    </article>
  );
}
