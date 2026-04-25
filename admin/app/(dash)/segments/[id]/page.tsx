'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Rule = {
  id?: string;
  field: string;
  operator: string;
  value: string;
  position: number;
};

type Segment = {
  id: string;
  name: string;
  description: string;
  matchAll: boolean;
  rules: Rule[];
  memberCount: number;
  updatedAt: string;
};

type Member = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  orderCount: number;
  totalSpentCents: number;
  currency: string;
};

const FIELDS = [
  { v: 'email', l: 'Email', kind: 'text' },
  { v: 'first_name', l: 'First name', kind: 'text' },
  { v: 'last_name', l: 'Last name', kind: 'text' },
  { v: 'country', l: 'Country (any address)', kind: 'text' },
  { v: 'tag', l: 'Tag', kind: 'text' },
  { v: 'marketing_consent', l: 'Marketing consent', kind: 'bool' },
  { v: 'total_spent', l: 'Total spent (cents)', kind: 'number' },
  { v: 'order_count', l: 'Order count', kind: 'number' },
  { v: 'last_order_days', l: 'Days since last order', kind: 'number' },
  { v: 'created_days', l: 'Days since signup', kind: 'number' },
] as const;

const OPS: Record<string, { v: string; l: string }[]> = {
  text: [
    { v: 'equals', l: 'equals' },
    { v: 'not_equals', l: 'not equals' },
    { v: 'contains', l: 'contains' },
    { v: 'not_contains', l: 'does not contain' },
    { v: 'starts_with', l: 'starts with' },
    { v: 'ends_with', l: 'ends with' },
    { v: 'is_null', l: 'is empty' },
    { v: 'is_not_null', l: 'is not empty' },
  ],
  number: [
    { v: 'equals', l: '=' },
    { v: 'not_equals', l: '≠' },
    { v: 'greater_than', l: '>' },
    { v: 'less_than', l: '<' },
    { v: 'is_null', l: 'is null' },
    { v: 'is_not_null', l: 'is not null' },
  ],
  bool: [
    { v: 'is_true', l: 'is true' },
    { v: 'is_false', l: 'is false' },
  ],
};

function fieldKind(field: string): string {
  return FIELDS.find((f) => f.v === field)?.kind ?? 'text';
}
function needsValue(op: string): boolean {
  return !['is_null', 'is_not_null', 'is_true', 'is_false'].includes(op);
}

export default function SegmentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [s, setS] = useState<Segment | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [loadingMembers, setLoadingMembers] = useState(false);

  async function load() {
    try {
      setS(await api<Segment>(`/api/admin/segments/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, [id]);

  async function previewMembers() {
    setLoadingMembers(true);
    try {
      const data = await api<{ items: Member[]; total: number }>(
        `/api/admin/segments/${id}/customers`,
      );
      setMembers(data.items ?? []);
      setMemberTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Preview failed');
    } finally {
      setLoadingMembers(false);
    }
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<Segment>(`/api/admin/segments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: s.name,
          description: s.description,
          matchAll: s.matchAll,
          rules: s.rules.map((r, i) => ({ ...r, position: i })),
        }),
      });
      setS(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm('Delete this segment?')) return;
    try {
      await api(`/api/admin/segments/${id}`, { method: 'DELETE' });
      router.push('/segments');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!s) return <section><p className="text-stone-500">Loading…</p></section>;

  const update = (patch: Partial<Segment>) => setS({ ...s, ...patch });
  const updateRule = (i: number, patch: Partial<Rule>) => {
    const rules = [...s.rules];
    rules[i] = { ...rules[i], ...patch } as Rule;
    update({ rules });
  };
  const addRule = () => update({
    rules: [...s.rules, { field: 'email', operator: 'contains', value: '', position: s.rules.length }],
  });
  const removeRule = (i: number) => update({ rules: s.rules.filter((_, idx) => idx !== i) });

  return (
    <section className="max-w-4xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/segments" className="text-sm text-stone-500 hover:underline">← Segments</Link>
        <h1 className="h-page flex-1">{s.name || 'Untitled segment'}</h1>
        <button onClick={del} className="btn btn-danger btn-sm">Delete</button>
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {error && <div className="mb-3 alert alert-error">{error}</div>}

      <div className="card card-pad mb-4 space-y-3 text-sm">
        <label className="block">
          <span className="label">Name</div>
          <input
            value={s.name}
            onChange={(e) => update({ name: e.target.value })}
            className="input"
          />
        </label>
        <label className="block">
          <span className="label">Description</div>
          <input
            value={s.description}
            onChange={(e) => update({ description: e.target.value })}
            className="input"
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            checked={s.matchAll}
            onChange={() => update({ matchAll: true })}
          />
          Match <b>all</b> rules (AND)
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="radio"
            checked={!s.matchAll}
            onChange={() => update({ matchAll: false })}
          />
          Match <b>any</b> rule (OR)
        </label>
      </div>

      <div className="card card-pad mb-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Rules</h2>
          <button onClick={addRule} className="btn btn-secondary btn-sm">
            + Add rule
          </button>
        </div>
        {s.rules.length === 0 ? (
          <p className="text-xs text-stone-500">
            No rules — segment matches every customer.
          </p>
        ) : (
          <ul className="space-y-2">
            {s.rules.map((r, i) => {
              const kind = fieldKind(r.field);
              const ops = OPS[kind] ?? OPS.text ?? [];
              return (
                <li key={i} className="flex items-center gap-2">
                  <select
                    value={r.field}
                    onChange={(e) => {
                      const f = e.target.value;
                      const k = fieldKind(f);
                      const list = OPS[k] ?? OPS.text ?? [];
                      const firstOp = list[0]?.v ?? 'equals';
                      updateRule(i, { field: f, operator: firstOp });
                    }}
                    className="select w-auto text-xs"
                  >
                    {FIELDS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
                  </select>
                  <select
                    value={r.operator}
                    onChange={(e) => updateRule(i, { operator: e.target.value })}
                    className="select w-auto text-xs"
                  >
                    {ops.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                  </select>
                  {needsValue(r.operator) && (
                    <input
                      value={r.value}
                      onChange={(e) => updateRule(i, { value: e.target.value })}
                      placeholder="value"
                      className="flex-1 px-2 py-1.5 rounded border border-stone-200 text-xs"
                    />
                  )}
                  <button
                    onClick={() => removeRule(i)}
                    className="text-red-700 hover:underline text-xs"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card card-pad mb-4 space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Members ({s.memberCount})</h2>
          <button onClick={previewMembers} disabled={loadingMembers} className="px-3 py-1 text-xs rounded border border-stone-200 hover:bg-gray-50 disabled:opacity-50">
            {loadingMembers ? 'Loading…' : 'Preview matches'}
          </button>
        </div>
        {members.length === 0 ? (
          <p className="text-xs text-stone-500">
            Click &ldquo;Preview matches&rdquo; to load the first 100 members.
          </p>
        ) : (
          <>
            <p className="text-xs text-stone-500">
              Showing {members.length} of {memberTotal} matching customers.
            </p>
            <ul className="divide-y divide-stone-200 text-xs">
              {members.map((m) => (
                <li key={m.id} className="py-1.5 flex items-center gap-3">
                  <Link href={`/customers/${m.id}`} className="font-medium hover:underline flex-1">{m.email}</Link>
                  <span className="text-stone-500">{m.firstName} {m.lastName}</span>
                  <span className="w-16 text-right">{m.orderCount} ords</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
