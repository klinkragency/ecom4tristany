'use client';

import { useState } from 'react';
import RichTextEditor from '@/components/RichTextEditor';
import { ApiError } from '@/lib/api';

export type PagePayload = {
  slug: string;
  title: string;
  contentHtml: string;
  excerpt: string;
  metaDescription: string;
  status: 'draft' | 'published';
};

export const EMPTY_PAGE: PagePayload = {
  slug: '',
  title: '',
  contentHtml: '',
  excerpt: '',
  metaDescription: '',
  status: 'draft',
};

export default function PageForm({
  initial, onSave, saveLabel = 'Save', onDelete,
}: {
  initial: PagePayload;
  onSave: (p: PagePayload) => Promise<void>;
  saveLabel?: string;
  onDelete?: () => Promise<void>;
}) {
  const [v, setV] = useState<PagePayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<PagePayload>) => setV({ ...v, ...patch });

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
      await onSave({ ...v, slug: v.slug.trim().toLowerCase() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  const input = "input";

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved.</div>}

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
        <Field label="Slug (URL path)" required>
          <input className={input + ' font-mono'}
            value={v.slug}
            onChange={(e) => update({ slug: e.target.value.toLowerCase() })}
            placeholder="about" />
          <div className="text-xs text-stone-500 mt-1">
            Page will be available at <span className="font-mono">/pages/{v.slug || '…'}</span>
          </div>
        </Field>
        <Field label="Short excerpt (shown on listings, optional)">
          <textarea rows={2} value={v.excerpt} onChange={(e) => update({ excerpt: e.target.value })}
            className={input} />
        </Field>
      </Card>

      <Card title="Content">
        <RichTextEditor value={v.contentHtml} onChange={(html) => update({ contentHtml: html })} minHeight={260} />
      </Card>

      <Card title="SEO">
        <Field label="Meta description (optional, 150-160 chars recommended)">
          <textarea rows={2} value={v.metaDescription} onChange={(e) => update({ metaDescription: e.target.value })}
            maxLength={200} className={input} />
          <div className="text-xs text-stone-500 mt-1">{v.metaDescription.length}/200</div>
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
          <button onClick={() => onDelete()} className="btn btn-danger btn-sm">
            Delete
          </button>
        ) : <span />}
        <button onClick={submit} disabled={saving}
          className="btn btn-primary">
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}{required && <span className="ml-0.5 text-red-600">*</span>}</span>
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
