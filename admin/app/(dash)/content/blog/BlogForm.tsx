'use client';

import { useState } from 'react';
import RichTextEditor from '@/components/RichTextEditor';
import { ApiError } from '@/lib/api';

export type BlogPayload = {
  slug: string;
  title: string;
  excerpt: string;
  contentHtml: string;
  authorName: string;
  featuredImageUrl: string;
  metaDescription: string;
  status: 'draft' | 'published';
  tags: string[];
};

export const EMPTY_POST: BlogPayload = {
  slug: '',
  title: '',
  excerpt: '',
  contentHtml: '',
  authorName: '',
  featuredImageUrl: '',
  metaDescription: '',
  status: 'draft',
  tags: [],
};

export default function BlogForm({
  initial, onSave, saveLabel = 'Save', onDelete,
}: {
  initial: BlogPayload;
  onSave: (p: BlogPayload) => Promise<void>;
  saveLabel?: string;
  onDelete?: () => Promise<void>;
}) {
  const [v, setV] = useState<BlogPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tagsStr, setTagsStr] = useState(initial.tags.join(', '));

  const update = (patch: Partial<BlogPayload>) => setV({ ...v, ...patch });

  async function submit() {
    if (!v.title.trim()) {
      setError('Title is required');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!v.slug.trim()) {
      setError('Slug is required');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const tags = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
      await onSave({ ...v, slug: v.slug.trim().toLowerCase(), tags });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)]';

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {saved && <div className="rounded border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">Saved.</div>}

      <Card title="Basics">
        <Field label="Title" required>
          <input className={input} value={v.title}
            onChange={(e) => {
              const newTitle = e.target.value;
              const wasAutoSlug = slugify(v.title) === v.slug || v.slug === '';
              update(wasAutoSlug
                ? { title: newTitle, slug: slugify(newTitle) }
                : { title: newTitle });
            }} />
        </Field>
        <Field label="Slug" required>
          <input className={input + ' font-mono'}
            value={v.slug} onChange={(e) => update({ slug: e.target.value.toLowerCase() })} />
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Post URL: <span className="font-mono">/blog/{v.slug || '…'}</span>
          </div>
        </Field>
        <Field label="Excerpt (shown on listings + feed)">
          <textarea rows={2} value={v.excerpt} onChange={(e) => update({ excerpt: e.target.value })} className={input} />
        </Field>
        <Field label="Author name">
          <input className={input} value={v.authorName} onChange={(e) => update({ authorName: e.target.value })} />
        </Field>
        <Field label="Featured image URL (optional)">
          <input className={input} value={v.featuredImageUrl}
            onChange={(e) => update({ featuredImageUrl: e.target.value })}
            placeholder="https://…" />
        </Field>
      </Card>

      <Card title="Content">
        <RichTextEditor value={v.contentHtml} onChange={(html) => update({ contentHtml: html })} minHeight={320} />
      </Card>

      <Card title="Tags">
        <input className={input} value={tagsStr} onChange={(e) => setTagsStr(e.target.value)}
          placeholder="announcements, behind-the-scenes, …" />
        <div className="text-xs text-[color:var(--color-text-muted)] mt-1">Comma-separated.</div>
      </Card>

      <Card title="SEO">
        <Field label="Meta description">
          <textarea rows={2} value={v.metaDescription} maxLength={200}
            onChange={(e) => update({ metaDescription: e.target.value })} className={input} />
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1">{v.metaDescription.length}/200</div>
        </Field>
      </Card>

      <Card title="Status">
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={v.status === 'draft'} onChange={() => update({ status: 'draft' })} />
            Draft
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={v.status === 'published'} onChange={() => update({ status: 'published' })} />
            Published
          </label>
        </div>
      </Card>

      <div className="flex justify-between">
        {onDelete ? (
          <button onClick={() => onDelete()} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50">
            Delete
          </button>
        ) : <span />}
        <button onClick={submit} disabled={saving}
          className="px-4 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
      {children}
    </label>
  );
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
