'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export type DiscountPayload = {
  code: string;
  title: string;
  kind: 'percentage' | 'amount' | 'free_shipping' | 'bogo';
  valuePercent?: number | null;
  valueCents?: number | null;
  scope: 'all' | 'products' | 'collections';
  eligibility: 'all' | 'segments';
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  minSubtotalCents: number;
  bogoBuyQuantity?: number | null;
  bogoGetQuantity?: number | null;
  bogoGetDiscountPercent?: number | null;
  bogoBuyScope?: 'products' | 'collections' | null;
  bogoGetScope?: 'products' | 'collections' | null;
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  productIds: string[];
  collectionIds: string[];
  buyProductIds: string[];
  buyCollectionIds: string[];
  getProductIds: string[];
  getCollectionIds: string[];
  segmentIds: string[];
};

export const EMPTY_DISCOUNT: DiscountPayload = {
  code: '',
  title: '',
  kind: 'percentage',
  valuePercent: 10,
  valueCents: null,
  scope: 'all',
  eligibility: 'all',
  usageLimit: null,
  usageLimitPerCustomer: null,
  minSubtotalCents: 0,
  bogoBuyQuantity: null,
  bogoGetQuantity: null,
  bogoGetDiscountPercent: null,
  bogoBuyScope: null,
  bogoGetScope: null,
  active: true,
  startsAt: null,
  endsAt: null,
  productIds: [],
  collectionIds: [],
  buyProductIds: [],
  buyCollectionIds: [],
  getProductIds: [],
  getCollectionIds: [],
  segmentIds: [],
};

type Product = { id: string; title: string; handle: string };
type Collection = { id: string; title: string; handle: string };
type Segment = { id: string; name: string };

export default function DiscountForm({
  initial,
  onSave,
  saveLabel = 'Save',
}: {
  initial: DiscountPayload;
  onSave: (p: DiscountPayload) => Promise<void>;
  saveLabel?: string;
}) {
  const [v, setV] = useState<DiscountPayload>(initial);
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [p, c, s] = await Promise.all([
          api<{ items: Product[] }>('/api/admin/products?limit=200').catch(() => ({ items: [] })),
          api<{ items: Collection[] }>('/api/admin/collections').catch(() => ({ items: [] })),
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
        ]);
        setProducts(p.items ?? []);
        setCollections(c.items ?? []);
        setSegments(s.items ?? []);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      // Normalise numeric empties to null for the server.
      const cleaned: DiscountPayload = {
        ...v,
        code: v.code.trim().toUpperCase(),
        valuePercent: v.kind === 'percentage' ? v.valuePercent : null,
        valueCents: v.kind === 'amount' ? v.valueCents : null,
        bogoBuyQuantity: v.kind === 'bogo' ? v.bogoBuyQuantity : null,
        bogoGetQuantity: v.kind === 'bogo' ? v.bogoGetQuantity : null,
        bogoGetDiscountPercent: v.kind === 'bogo' ? v.bogoGetDiscountPercent : null,
        bogoBuyScope: v.kind === 'bogo' ? v.bogoBuyScope : null,
        bogoGetScope: v.kind === 'bogo' ? v.bogoGetScope : null,
      };
      await onSave(cleaned);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)]';

  return (
    <div className="space-y-4 max-w-3xl">
      {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <Card title="Basics">
        <Field label="Title (admin-facing)" required>
          <input className={inputCls} value={v.title} onChange={(e) => update({ title: e.target.value })} />
        </Field>
        <Field label="Code (leave empty for automatic discount)">
          <input className={inputCls + ' font-mono uppercase'}
            value={v.code}
            onChange={(e) => update({ code: e.target.value.toUpperCase() })}
            placeholder="SUMMER20" />
        </Field>
      </Card>

      <Card title="Type">
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="radio" checked={v.kind === 'percentage'} onChange={() => update({ kind: 'percentage', valuePercent: 10 })} />
          Percentage off
        </label>
        {v.kind === 'percentage' && (
          <Field label="Percent">
            <input type="number" step="0.01" min={0} max={100}
              value={v.valuePercent ?? ''}
              onChange={(e) => update({ valuePercent: e.target.value === '' ? null : Number(e.target.value) })}
              className={inputCls} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="radio" checked={v.kind === 'amount'} onChange={() => update({ kind: 'amount', valueCents: 500 })} />
          Fixed amount off
        </label>
        {v.kind === 'amount' && (
          <Field label="Amount (€)">
            <input type="number" step="0.01" min={0}
              value={v.valueCents == null ? '' : (v.valueCents / 100).toFixed(2)}
              onChange={(e) => update({ valueCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })}
              className={inputCls} />
          </Field>
        )}
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="radio" checked={v.kind === 'free_shipping'} onChange={() => update({ kind: 'free_shipping' })} />
          Free shipping
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={v.kind === 'bogo'} onChange={() => update({
            kind: 'bogo',
            bogoBuyQuantity: 1, bogoGetQuantity: 1, bogoGetDiscountPercent: 100,
            bogoBuyScope: 'products', bogoGetScope: 'products',
          })} />
          Buy X Get Y (BOGO)
        </label>
      </Card>

      {v.kind === 'bogo' && (
        <Card title="BOGO details">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Buy (qty)">
              <input type="number" min={1} value={v.bogoBuyQuantity ?? 1}
                onChange={(e) => update({ bogoBuyQuantity: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Get (qty)">
              <input type="number" min={1} value={v.bogoGetQuantity ?? 1}
                onChange={(e) => update({ bogoGetQuantity: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label="Get discount (%)">
              <input type="number" min={0} max={100} value={v.bogoGetDiscountPercent ?? 100}
                onChange={(e) => update({ bogoGetDiscountPercent: Number(e.target.value) })} className={inputCls} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Buy from">
              <select value={v.bogoBuyScope ?? 'products'} onChange={(e) => update({ bogoBuyScope: e.target.value as 'products' | 'collections' })}
                className={inputCls + ' bg-white'}>
                <option value="products">Specific products</option>
                <option value="collections">Collections</option>
              </select>
            </Field>
            <Field label="Get from">
              <select value={v.bogoGetScope ?? 'products'} onChange={(e) => update({ bogoGetScope: e.target.value as 'products' | 'collections' })}
                className={inputCls + ' bg-white'}>
                <option value="products">Specific products</option>
                <option value="collections">Collections</option>
              </select>
            </Field>
          </div>
          {v.bogoBuyScope === 'products' ? (
            <MultiPicker label="Buy these products" options={products.map((p) => ({ id: p.id, label: p.title }))}
              selected={v.buyProductIds} onChange={(ids) => update({ buyProductIds: ids })} />
          ) : (
            <MultiPicker label="Buy from these collections" options={collections.map((c) => ({ id: c.id, label: c.title }))}
              selected={v.buyCollectionIds} onChange={(ids) => update({ buyCollectionIds: ids })} />
          )}
          {v.bogoGetScope === 'products' ? (
            <MultiPicker label="Get these products" options={products.map((p) => ({ id: p.id, label: p.title }))}
              selected={v.getProductIds} onChange={(ids) => update({ getProductIds: ids })} />
          ) : (
            <MultiPicker label="Get from these collections" options={collections.map((c) => ({ id: c.id, label: c.title }))}
              selected={v.getCollectionIds} onChange={(ids) => update({ getCollectionIds: ids })} />
          )}
        </Card>
      )}

      {v.kind !== 'bogo' && v.kind !== 'free_shipping' && (
        <Card title="Applies to">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="radio" checked={v.scope === 'all'} onChange={() => update({ scope: 'all' })} />
            Entire order
          </label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="radio" checked={v.scope === 'products'} onChange={() => update({ scope: 'products' })} />
            Specific products
          </label>
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="radio" checked={v.scope === 'collections'} onChange={() => update({ scope: 'collections' })} />
            Collections
          </label>
          {v.scope === 'products' && (
            <MultiPicker label="Products" options={products.map((p) => ({ id: p.id, label: p.title }))}
              selected={v.productIds} onChange={(ids) => update({ productIds: ids })} />
          )}
          {v.scope === 'collections' && (
            <MultiPicker label="Collections" options={collections.map((c) => ({ id: c.id, label: c.title }))}
              selected={v.collectionIds} onChange={(ids) => update({ collectionIds: ids })} />
          )}
        </Card>
      )}

      <Card title="Eligibility">
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="radio" checked={v.eligibility === 'all'} onChange={() => update({ eligibility: 'all' })} />
          All customers
        </label>
        <label className="flex items-center gap-2 text-sm mb-2">
          <input type="radio" checked={v.eligibility === 'segments'} onChange={() => update({ eligibility: 'segments' })} />
          Only customers in these segments
        </label>
        {v.eligibility === 'segments' && (
          <MultiPicker label="Segments" options={segments.map((s) => ({ id: s.id, label: s.name }))}
            selected={v.segmentIds} onChange={(ids) => update({ segmentIds: ids })} />
        )}
      </Card>

      <Card title="Limits & schedule">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min order subtotal (€)">
            <input type="number" step="0.01" min={0}
              value={(v.minSubtotalCents / 100).toFixed(2)}
              onChange={(e) => update({ minSubtotalCents: Math.round(Number(e.target.value) * 100) })}
              className={inputCls} />
          </Field>
          <Field label="Total uses (empty = unlimited)">
            <input type="number" min={0}
              value={v.usageLimit ?? ''}
              onChange={(e) => update({ usageLimit: e.target.value === '' ? null : Number(e.target.value) })}
              className={inputCls} />
          </Field>
          <Field label="Uses per customer (empty = unlimited)">
            <input type="number" min={0}
              value={v.usageLimitPerCustomer ?? ''}
              onChange={(e) => update({ usageLimitPerCustomer: e.target.value === '' ? null : Number(e.target.value) })}
              className={inputCls} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts at">
            <input type="datetime-local"
              value={v.startsAt ? v.startsAt.slice(0, 16) : ''}
              onChange={(e) => update({ startsAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className={inputCls} />
          </Field>
          <Field label="Ends at">
            <input type="datetime-local"
              value={v.endsAt ? v.endsAt.slice(0, 16) : ''}
              onChange={(e) => update({ endsAt: e.target.value ? new Date(e.target.value).toISOString() : null })}
              className={inputCls} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.active} onChange={(e) => update({ active: e.target.checked })} />
          Active
        </label>
      </Card>

      <div className="flex justify-end">
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
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <div className="text-sm font-medium mb-1">{label}{required && <span className="text-red-600 ml-0.5">*</span>}</div>
      {children}
    </label>
  );
}

function MultiPicker({
  label, options, selected, onChange,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div className="mt-2">
      <div className="text-sm font-medium mb-1">{label}</div>
      {options.length === 0 ? (
        <p className="text-xs text-[color:var(--color-text-muted)]">None available.</p>
      ) : (
        <ul className="max-h-40 overflow-y-auto border border-[color:var(--color-border)] rounded text-sm divide-y divide-[color:var(--color-border)]">
          {options.map((o) => (
            <li key={o.id}>
              <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
