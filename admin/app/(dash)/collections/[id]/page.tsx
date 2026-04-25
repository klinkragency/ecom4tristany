'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type Collection, type CollectionRule, type SortOrder } from '@/lib/types';
import ProductPicker from './ProductPicker';
import RichTextEditor from '@/components/RichTextEditor';

const FIELD_LABELS: Record<CollectionRule['field'], string> = {
  title: 'Title',
  vendor: 'Vendor',
  product_type: 'Product type',
  tag: 'Tag',
  price: 'Price (€)',
  inventory: 'Inventory',
  status: 'Status',
};

const OPERATOR_LABELS: Record<CollectionRule['operator'], string> = {
  equals: 'is',
  not_equals: 'is not',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  greater_than: 'is greater than',
  less_than: 'is less than',
  in_stock: 'is in stock',
  out_of_stock: 'is out of stock',
};

export default function EditCollectionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [collection, setCollection] = useState<Collection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('manual');
  const [matchAll, setMatchAll] = useState(true);

  async function refetch() {
    try {
      const c = await api<Collection>(`/api/admin/collections/${id}`);
      setCollection(c);
      setTitle(c.title);
      setHandle(c.handle);
      setDescription(c.descriptionHtml);
      setSortOrder(c.sortOrder);
      setMatchAll(c.matchAll);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/admin/collections/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          handle,
          descriptionHtml: description,
          sortOrder,
          matchAll,
        }),
      });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm('Delete this collection?')) return;
    try {
      await api(`/api/admin/collections/${id}`, { method: 'DELETE' });
      router.push('/collections');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function detach(productId: string) {
    try {
      await api(`/api/admin/collections/${id}/products/${productId}`, { method: 'DELETE' });
      await refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Detach failed');
    }
  }

  async function addRule(field: CollectionRule['field'], operator: CollectionRule['operator'], value: string) {
    try {
      await api(`/api/admin/collections/${id}/rules`, {
        method: 'POST',
        body: JSON.stringify({ field, operator, value }),
      });
      await refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Add rule failed');
    }
  }

  async function delRule(ruleId: string) {
    try {
      await api(`/api/admin/rules/${ruleId}`, { method: 'DELETE' });
      await refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete rule failed');
    }
  }

  if (!collection) {
    return (
      <section>
        <p className="text-stone-500">Loading…</p>
        {error && <div className="mt-3 text-red-700 text-sm">{error}</div>}
      </section>
    );
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/collections" className="text-sm text-stone-500 hover:underline">
            ← Collections
          </Link>
          <h1 className="text-2xl font-semibold">{collection.title}</h1>
          <span
            className={`inline-block rounded px-2 py-0.5 text-xs ${
              collection.isRulesBased ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            {collection.isRulesBased ? 'Rule-based' : 'Manual'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={del}
            className="px-3 py-2 rounded border border-red-200 text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 alert alert-error">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Card title="Basic info">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-stone-200"
            />
          </Field>
          <Field label="Handle">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-stone-200 font-mono text-sm"
            />
          </Field>
          <Field label="Description">
            <RichTextEditor
              value={description}
              onChange={setDescription}
              placeholder="Describe the collection…"
              minHeight={140}
            />
          </Field>
          <Field label="Sort order">
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="w-full px-3 py-2 rounded border border-stone-200 bg-white"
            >
              {!collection.isRulesBased && <option value="manual">Manual</option>}
              <option value="created_desc">Newest first</option>
              <option value="alpha_asc">Alphabetical A–Z</option>
              <option value="alpha_desc">Alphabetical Z–A</option>
              <option value="price_asc">Price low → high</option>
              <option value="price_desc">Price high → low</option>
              <option value="best_selling">Best selling (stub until Phase 3)</option>
            </select>
          </Field>
        </Card>

        {collection.isRulesBased ? (
          <RulesEditor
            rules={collection.rules}
            matchAll={matchAll}
            onMatchAllChange={setMatchAll}
            onAdd={addRule}
            onDelete={delRule}
          />
        ) : (
          <Card title={`Products (${collection.products.length})`}>
            <button
              onClick={() => setPicker(true)}
              className="px-3 py-2 text-sm rounded border border-stone-200 hover:bg-gray-50 mb-3"
            >
              Add products…
            </button>
            <ProductList products={collection.products} onDetach={detach} />
            {picker && (
              <ProductPicker
                collectionId={id}
                existingIds={new Set(collection.products.map((p) => p.id))}
                onClose={() => setPicker(false)}
                onAttached={async () => {
                  setPicker(false);
                  await refetch();
                }}
              />
            )}
          </Card>
        )}

        {collection.isRulesBased && (
          <Card title={`Matched products (${collection.products.length})`}>
            <p className="text-xs text-stone-500 mb-3">
              Preview of what the rules currently match.
            </p>
            <ProductList products={collection.products} />
          </Card>
        )}
      </div>
    </section>
  );
}

function RulesEditor({
  rules,
  matchAll,
  onMatchAllChange,
  onAdd,
  onDelete,
}: {
  rules: CollectionRule[];
  matchAll: boolean;
  onMatchAllChange: (v: boolean) => void;
  onAdd: (f: CollectionRule['field'], op: CollectionRule['operator'], val: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [field, setField] = useState<CollectionRule['field']>('title');
  const [operator, setOperator] = useState<CollectionRule['operator']>('equals');
  const [value, setValue] = useState('');

  const validOps = operatorsFor(field);
  if (!validOps.includes(operator)) {
    // reset if previously picked op no longer valid
    setTimeout(() => setOperator(validOps[0]!), 0);
  }
  const needsValue = operator !== 'in_stock' && operator !== 'out_of_stock';

  return (
    <div className="rounded border border-stone-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Rules</h2>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={matchAll}
            onChange={(e) => onMatchAllChange(e.target.checked)}
          />
          Match all (AND) — uncheck for any (OR)
        </label>
      </div>

      {rules.length === 0 && (
        <p className="text-sm text-stone-500">
          Add at least one rule for products to appear in this collection.
        </p>
      )}

      <div className="space-y-2">
        {rules.map((r) => (
          <div
            key={r.id}
            className="flex items-center gap-2 text-sm border border-stone-200 rounded px-3 py-2"
          >
            <span className="font-medium">{FIELD_LABELS[r.field]}</span>
            <span className="text-stone-500">{OPERATOR_LABELS[r.operator]}</span>
            {r.value && <span className="font-mono bg-gray-100 px-1.5 rounded">{r.value}</span>}
            <button
              onClick={() => onDelete(r.id)}
              className="ml-auto text-xs text-red-700 hover:underline"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="pt-3 border-t border-stone-200 grid grid-cols-[1fr_1fr_2fr_auto] gap-2 text-sm">
        <select
          value={field}
          onChange={(e) => setField(e.target.value as CollectionRule['field'])}
          className="px-2 py-1 rounded border border-stone-200 bg-white"
        >
          {Object.entries(FIELD_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value as CollectionRule['operator'])}
          className="px-2 py-1 rounded border border-stone-200 bg-white"
        >
          {validOps.map((op) => (
            <option key={op} value={op}>
              {OPERATOR_LABELS[op]}
            </option>
          ))}
        </select>
        {needsValue ? (
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field === 'price' ? 'e.g. 25' : field === 'status' ? 'active / draft / archived' : 'value'}
            className="px-2 py-1 rounded border border-stone-200"
          />
        ) : (
          <div />
        )}
        <button
          onClick={async () => {
            await onAdd(field, operator, needsValue ? value : '');
            setValue('');
          }}
          className="px-3 py-1 rounded bg-gray-900 text-white hover:bg-gray-800"
        >
          Add rule
        </button>
      </div>
    </div>
  );
}

function operatorsFor(field: CollectionRule['field']): CollectionRule['operator'][] {
  switch (field) {
    case 'title':
    case 'vendor':
    case 'product_type':
      return ['equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with'];
    case 'tag':
      return ['equals', 'not_equals'];
    case 'price':
      return ['greater_than', 'less_than', 'equals', 'not_equals'];
    case 'inventory':
      return ['in_stock', 'out_of_stock'];
    case 'status':
      return ['equals', 'not_equals'];
  }
}

function ProductList({
  products,
  onDetach,
}: {
  products: Collection['products'];
  onDetach?: (productId: string) => Promise<void>;
}) {
  if (products.length === 0) {
    return <p className="text-sm text-stone-500">No products.</p>;
  }
  return (
    <ul className="divide-y divide-stone-200">
      {products.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2 text-sm">
          <div className="w-10 h-10 rounded bg-gray-100 overflow-hidden shrink-0">
            {p.primaryImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.primaryImageUrl} alt="" className="w-full h-full object-cover" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{p.title}</div>
            <div className="text-xs text-stone-500">
              {p.handle} · {p.status}
            </div>
          </div>
          <div className="text-xs text-stone-500">
            {p.minPriceCents === p.maxPriceCents
              ? formatPrice(p.minPriceCents)
              : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
          </div>
          {onDetach && (
            <button
              onClick={() => onDetach(p.id)}
              className="text-xs text-red-700 hover:underline"
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-4 space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
