import SafeHtml from '@/app/products/[handle]/SafeHtml';

export type FieldDef = {
  key: string;
  name: string;
  type:
    | 'single_line_text'
    | 'multi_line_text'
    | 'rich_text'
    | 'number'
    | 'boolean'
    | 'url'
    | 'file'
    | 'date'
    | 'color';
  required?: boolean;
  help?: string;
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url, 'http://x');
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : url;
  } catch {
    return url;
  }
}

export function MetaFieldView({ def, value }: { def: FieldDef; value: unknown }) {
  if (value === undefined || value === null || value === '') return null;

  switch (def.type) {
    case 'single_line_text':
      return <span>{String(value)}</span>;

    case 'multi_line_text':
      return <p className="whitespace-pre-wrap text-sm leading-relaxed">{String(value)}</p>;

    case 'rich_text':
      return <SafeHtml html={String(value)} className="prose max-w-none text-sm" />;

    case 'number':
      return <span className="tabular-nums">{String(value)}</span>;

    case 'boolean':
      return (
        <span className="text-sm">
          {value ? '✓ Yes' : '– No'}
        </span>
      );

    case 'url':
      return (
        <a
          href={String(value)}
          className="text-sm underline hover:no-underline"
          rel="noopener noreferrer"
          target={String(value).startsWith('/') ? undefined : '_blank'}
        >
          {String(value)}
        </a>
      );

    case 'file':
      return (
        <a
          href={String(value)}
          className="inline-flex items-center gap-2 text-sm underline hover:no-underline"
          download
        >
          <span aria-hidden>⬇</span>
          <span>{fileNameFromUrl(String(value))}</span>
        </a>
      );

    case 'date':
      return <time dateTime={String(value)}>{formatDate(String(value))}</time>;

    case 'color':
      return (
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block h-4 w-4 rounded border border-black/10"
            style={{ background: String(value) }}
            aria-hidden
          />
          <span className="font-mono text-xs uppercase">{String(value)}</span>
        </span>
      );

    default:
      return <span>{String(value)}</span>;
  }
}

// A field on its own (for detail view): label + value stacked.
export function MetaFieldRow({ def, value }: { def: FieldDef; value: unknown }) {
  if (value === undefined || value === null || value === '') return null;
  const block = def.type === 'rich_text' || def.type === 'multi_line_text';
  return (
    <div className={block ? 'space-y-2' : 'flex flex-wrap items-baseline gap-3'}>
      <dt className="text-xs uppercase tracking-wide text-[color:var(--color-text-muted)]">
        {def.name}
      </dt>
      <dd>
        <MetaFieldView def={def} value={value} />
      </dd>
    </div>
  );
}
