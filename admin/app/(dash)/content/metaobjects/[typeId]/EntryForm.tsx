'use client';

import { useState } from 'react';
import RichTextEditor from '@/components/RichTextEditor';
import type { FieldDef } from '../TypeForm';
import { ApiError } from '@/lib/api';

export type EntryPayload = {
  handle: string;
  name: string;
  status: 'draft' | 'published';
  fields: Record<string, unknown>;
  position: number;
};

export const EMPTY_ENTRY: EntryPayload = {
  handle: '',
  name: '',
  status: 'draft',
  fields: {},
  position: 0,
};

// Renders one input per FieldDef, picking the component based on field type.
// The admin form is completely derived from the type's schema — no hardcoding.
export default function EntryForm({
  initial, fieldDefs, onSave, saveLabel = 'Save', onDelete,
}: {
  initial: EntryPayload;
  fieldDefs: FieldDef[];
  onSave: (p: EntryPayload) => Promise<void>;
  saveLabel?: string;
  onDelete?: () => Promise<void>;
}) {
  const [v, setV] = useState<EntryPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function setField(key: string, value: unknown) {
    setV({ ...v, fields: { ...v.fields, [key]: value } });
  }

  async function submit() {
    if (!v.name.trim() || !v.handle.trim()) {
      setError('Name and handle are required'); return;
    }
    setSaving(true); setError(null); setSaved(false);
    try {
      await onSave(v);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm';

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {saved && <div className="rounded border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">Saved.</div>}

      <Card title="Basics">
        <Row label="Name" required>
          <input className={input} value={v.name}
            onChange={(e) => {
              const name = e.target.value;
              const wasAuto = slugify(v.name) === v.handle || v.handle === '';
              setV(wasAuto ? { ...v, name, handle: slugify(name) } : { ...v, name });
            }} />
        </Row>
        <Row label="Handle" required>
          <input className={input + ' font-mono'} value={v.handle}
            onChange={(e) => setV({ ...v, handle: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
        </Row>
      </Card>

      <Card title="Fields">
        {fieldDefs.length === 0 ? (
          <p className="text-sm text-[color:var(--color-text-muted)]">
            This type has no fields yet. Add some in the schema editor to see inputs here.
          </p>
        ) : (
          <div className="space-y-3">
            {fieldDefs.map((def) => (
              <FieldInput key={def.key} def={def}
                value={v.fields[def.key]}
                onChange={(val) => setField(def.key, val)} />
            ))}
          </div>
        )}
      </Card>

      <Card title="Status">
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={v.status === 'draft'} onChange={() => setV({ ...v, status: 'draft' })} />
            Draft
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={v.status === 'published'} onChange={() => setV({ ...v, status: 'published' })} />
            Published
          </label>
        </div>
      </Card>

      <div className="flex justify-between">
        {onDelete ? (
          <button onClick={() => onDelete()}
            className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50">
            Delete entry
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

function FieldInput({ def, value, onChange }: {
  def: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm';
  const label = (
    <div className="text-sm font-medium mb-1">
      {def.name}{def.required && <span className="text-red-600 ml-0.5">*</span>}
      <span className="ml-2 text-xs font-mono text-[color:var(--color-text-muted)]">{def.key}</span>
    </div>
  );
  const help = def.help ? (
    <div className="text-xs text-[color:var(--color-text-muted)] mt-1">{def.help}</div>
  ) : null;

  const strVal = (value ?? '') as string;

  switch (def.type) {
    case 'single_line_text':
      return (
        <label className="block">
          {label}
          <input className={input} value={strVal} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case 'multi_line_text':
      return (
        <label className="block">
          {label}
          <textarea rows={4} className={input} value={strVal} onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case 'rich_text':
      return (
        <div>
          {label}
          <RichTextEditor value={strVal} onChange={(html) => onChange(html)} minHeight={180} />
          {help}
        </div>
      );
    case 'number':
      return (
        <label className="block">
          {label}
          <input type="number" className={input}
            value={value == null ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
          {help}
        </label>
      );
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          <span className="font-medium">{def.name}</span>
          <span className="text-xs font-mono text-[color:var(--color-text-muted)]">{def.key}</span>
          {help}
        </label>
      );
    case 'url':
    case 'file':
      return (
        <label className="block">
          {label}
          <input type="url" className={input} value={strVal}
            placeholder={def.type === 'file' ? 'https://…/file.pdf' : 'https://…'}
            onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case 'date':
      return (
        <label className="block">
          {label}
          <input type="date" className={input} value={strVal}
            onChange={(e) => onChange(e.target.value)} />
          {help}
        </label>
      );
    case 'color':
      return (
        <label className="block">
          {label}
          <div className="flex items-center gap-2">
            <input type="color" value={strVal || '#000000'}
              onChange={(e) => onChange(e.target.value)}
              className="h-10 w-14 rounded border border-[color:var(--color-border)] cursor-pointer" />
            <input className={input + ' font-mono uppercase'} value={strVal}
              placeholder="#RRGGBB" maxLength={7}
              onChange={(e) => onChange(e.target.value)} />
          </div>
          {help}
        </label>
      );
  }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
      {children}
    </label>
  );
}

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
