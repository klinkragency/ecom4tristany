'use client';

import { useState } from 'react';
import { Card, Field } from '@/components/ui';
import { ApiError } from '@/lib/api';

export type FieldType =
  | 'single_line_text'
  | 'multi_line_text'
  | 'rich_text'
  | 'number'
  | 'boolean'
  | 'url'
  | 'file'
  | 'date'
  | 'color';

export const FIELD_TYPES: Array<{ v: FieldType; label: string; hint: string }> = [
  { v: 'single_line_text', label: 'Single-line text', hint: 'Short text — title, author…' },
  { v: 'multi_line_text',  label: 'Multi-line text',  hint: 'Plain textarea — address, notes' },
  { v: 'rich_text',        label: 'Rich text (HTML)', hint: 'WYSIWYG formatted content' },
  { v: 'number',           label: 'Number',           hint: 'Integer or decimal' },
  { v: 'boolean',          label: 'Boolean',          hint: 'Checkbox true/false' },
  { v: 'url',              label: 'URL',              hint: 'Absolute http(s) or absolute path' },
  { v: 'file',             label: 'File (URL)',       hint: 'R2 / CDN URL — picker coming later' },
  { v: 'date',             label: 'Date',             hint: 'YYYY-MM-DD or RFC3339' },
  { v: 'color',            label: 'Color',            hint: 'Hex #RRGGBB' },
];

export type FieldDef = {
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  help?: string;
};

export type TypePayload = {
  handle: string;
  name: string;
  description: string;
  fieldDefs: FieldDef[];
};

export const EMPTY_TYPE: TypePayload = {
  handle: '',
  name: '',
  description: '',
  fieldDefs: [],
};

export default function TypeForm({
  initial, onSave, saveLabel = 'Save', onDelete,
}: {
  initial: TypePayload;
  onSave: (p: TypePayload) => Promise<void>;
  saveLabel?: string;
  onDelete?: () => Promise<void>;
}) {
  const [v, setV] = useState<TypePayload>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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

  function addField() {
    setV({ ...v, fieldDefs: [...v.fieldDefs, { key: '', name: '', type: 'single_line_text', required: false }] });
  }
  function removeField(i: number) {
    setV({ ...v, fieldDefs: v.fieldDefs.filter((_, idx) => idx !== i) });
  }
  function updateField(i: number, patch: Partial<FieldDef>) {
    const next = [...v.fieldDefs];
    next[i] = { ...next[i]!, ...patch };
    setV({ ...v, fieldDefs: next });
  }
  function moveField(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= v.fieldDefs.length) return;
    const next = [...v.fieldDefs];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setV({ ...v, fieldDefs: next });
  }

  const input = "input text-sm";

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved.</div>}

      <Card title="Basics">
        <Field label="Name" required>
          <input className={input} value={v.name}
            onChange={(e) => {
              const name = e.target.value;
              const wasAuto = snake(v.name) === v.handle || v.handle === '';
              setV(wasAuto ? { ...v, name, handle: snake(name) } : { ...v, name });
            }} />
        </Field>
        <Field label="Handle" required>
          <input className={input + ' font-mono'} value={v.handle}
            onChange={(e) => setV({ ...v, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
          <div className="text-xs text-stone-500 mt-1">
            Entries are fetched on the storefront as <span className="font-mono">/metaobjects/{v.handle || '…'}</span>.
          </div>
        </Field>
        <Field label="Description">
          <textarea rows={2} className={input}
            value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </Field>
      </Card>

      <Card title="Fields">
        {v.fieldDefs.length === 0 ? (
          <p className="text-xs text-stone-500">
            No fields yet. Add at least one so this type is useful.
          </p>
        ) : (
          <ul className="space-y-2">
            {v.fieldDefs.map((f, i) => (
              <li key={i} className="border border-stone-200 rounded p-3 space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <button onClick={() => moveField(i, -1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▲</button>
                    <button onClick={() => moveField(i, 1)} className="text-xs hover:bg-gray-100 rounded w-5 h-4 leading-none">▼</button>
                  </div>
                  <input className={input + ' flex-1'} placeholder="Name (e.g. Shipping policy)"
                    value={f.name} onChange={(e) => updateField(i, { name: e.target.value })} />
                  <button onClick={() => removeField(i)} className="btn btn-ghost btn-sm text-red-700">Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className={input + ' font-mono'} placeholder="handle_snake_case"
                    value={f.key} onChange={(e) => updateField(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
                  <select className={input + ' bg-white'} value={f.type}
                    onChange={(e) => updateField(i, { type: e.target.value as FieldType })}>
                    {FIELD_TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                  </select>
                </div>
                <input className={input} placeholder="Help text (optional, shown under the input)"
                  value={f.help ?? ''} onChange={(e) => updateField(i, { help: e.target.value })} />
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={f.required}
                    onChange={(e) => updateField(i, { required: e.target.checked })} />
                  Required
                </label>
              </li>
            ))}
          </ul>
        )}
        <button onClick={addField}
          className="btn btn-secondary btn-sm mt-3">
          + Add field
        </button>
      </Card>

      <div className="flex justify-between">
        {onDelete ? (
          <button onClick={() => onDelete()}
            className="btn btn-danger btn-sm">
            Delete type
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

function snake(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}
