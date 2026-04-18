'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type Product, type ProductVariant } from '@/lib/types';

export default function EditProductPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  // local form state mirroring the product
  const [title, setTitle] = useState('');
  const [handle, setHandle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>('draft');
  const [vendor, setVendor] = useState('');
  const [productType, setProductType] = useState('');
  const [tagsStr, setTagsStr] = useState('');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');

  async function refetch() {
    try {
      const p = await api<Product>(`/api/admin/products/${id}`);
      setProduct(p);
      setTitle(p.title);
      setHandle(p.handle);
      setDescription(p.descriptionHtml);
      setStatus(p.status);
      setVendor(p.vendor);
      setProductType(p.productType);
      setTagsStr(p.tags.join(', '));
      setSeoTitle(p.seoTitle);
      setSeoDesc(p.seoDescription);
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
      const updated = await api<Product>(`/api/admin/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title,
          handle,
          descriptionHtml: description,
          status,
          vendor,
          productType,
          tags: tagsStr.split(',').map((t) => t.trim()).filter(Boolean),
          seoTitle,
          seoDescription: seoDesc,
        }),
      });
      setProduct(updated);
      setHandle(updated.handle); // server may have changed it
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm('Delete this product? This cannot be undone.')) return;
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' });
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  if (!product) {
    return (
      <section>
        <p className="text-[color:var(--color-text-muted)]">Loading…</p>
        {error && <div className="mt-3 text-red-700 text-sm">{error}</div>}
      </section>
    );
  }

  return (
    <section className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href="/products" className="text-sm text-[color:var(--color-text-muted)] hover:underline">
            ← Products
          </Link>
          <h1 className="text-2xl font-semibold">{product.title}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {savedAt && (
            <span className="text-[color:var(--color-text-muted)]">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={del}
            className="px-3 py-2 rounded border border-red-200 text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-3 py-2 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Card title="Basic info">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </Field>
          <Field label="Handle (URL slug)">
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] font-mono text-sm"
            />
          </Field>
          <Field label="Description (HTML)">
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] font-mono text-sm"
            />
          </Field>
        </Card>

        <OptionsEditor product={product} onChanged={refetch} onError={setError} />
        <VariantsEditor product={product} onChanged={refetch} onError={setError} />

        <Card title="Organization">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </Field>
            <Field label="Vendor">
              <input
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
              />
            </Field>
            <Field label="Product type">
              <input
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
              />
            </Field>
            <Field label="Tags (comma-separated)">
              <input
                value={tagsStr}
                onChange={(e) => setTagsStr(e.target.value)}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
              />
            </Field>
          </div>
        </Card>

        <Card title="SEO">
          <Field label="SEO title">
            <input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </Field>
          <Field label="SEO description">
            <textarea
              rows={2}
              value={seoDesc}
              onChange={(e) => setSeoDesc(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </Field>
        </Card>
      </div>
    </section>
  );
}

function OptionsEditor({
  product,
  onChanged,
  onError,
}: {
  product: Product;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [name, setName] = useState('');
  const [values, setValues] = useState('');

  async function add() {
    if (!name.trim()) return;
    try {
      await api(`/api/admin/products/${product.id}/options`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          values: values.split(',').map((v) => v.trim()).filter(Boolean),
        }),
      });
      setName('');
      setValues('');
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to add option');
    }
  }

  async function del(oid: string) {
    if (!confirm('Remove this option and any variants using it?')) return;
    try {
      await api(`/api/admin/options/${oid}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to remove option');
    }
  }

  async function addValue(oid: string, value: string) {
    const v = value.trim();
    if (!v) return;
    try {
      await api(`/api/admin/options/${oid}/values`, {
        method: 'POST',
        body: JSON.stringify({ value: v }),
      });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to add value');
    }
  }

  async function delValue(vid: string) {
    if (!confirm('Remove this value? Any variants using it will also be removed.')) return;
    try {
      await api(`/api/admin/option-values/${vid}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to remove value');
    }
  }

  return (
    <Card title={`Options (${product.options.length} / 3)`}>
      {product.options.length === 0 && (
        <p className="text-sm text-[color:var(--color-text-muted)]">
          No options yet. A product with no options has one default variant.
        </p>
      )}
      {product.options.map((o) => (
        <div key={o.id} className="border border-[color:var(--color-border)] rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium text-sm">{o.name}</div>
            <button onClick={() => del(o.id)} className="text-xs text-red-700 hover:underline">
              Remove option
            </button>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            {o.values.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 text-xs rounded bg-gray-100 px-2 py-1"
              >
                {v.value}
                <button
                  onClick={() => delValue(v.id)}
                  className="text-gray-500 hover:text-red-700"
                  title="Remove value"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <AddValueInput onAdd={(val) => addValue(o.id, val)} />
        </div>
      ))}

      {product.options.length < 3 && (
        <div className="border-t border-[color:var(--color-border)] pt-3">
          <div className="text-xs uppercase tracking-wide text-[color:var(--color-text-muted)] mb-2">
            Add new option
          </div>
          <div className="grid grid-cols-[1fr_2fr_auto] gap-2">
            <input
              placeholder="Option name (e.g. Size)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 rounded border border-[color:var(--color-border)] text-sm"
            />
            <input
              placeholder="Values, comma-separated (e.g. S, M, L)"
              value={values}
              onChange={(e) => setValues(e.target.value)}
              className="px-3 py-2 rounded border border-[color:var(--color-border)] text-sm"
            />
            <button
              onClick={add}
              className="px-3 py-2 text-sm rounded bg-gray-900 text-white hover:bg-gray-800"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

function AddValueInput({ onAdd }: { onAdd: (v: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div className="flex gap-2">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder="New value…"
        className="flex-1 px-2 py-1 rounded border border-[color:var(--color-border)] text-sm"
      />
      <button
        onClick={() => {
          onAdd(v);
          setV('');
        }}
        className="px-2 py-1 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50"
      >
        Add value
      </button>
    </div>
  );
}

function VariantsEditor({
  product,
  onChanged,
  onError,
}: {
  product: Product;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  async function del(vid: string) {
    if (product.variants.length <= 1) {
      onError('Cannot delete the last variant of a product');
      return;
    }
    if (!confirm('Delete this variant?')) return;
    try {
      await api(`/api/admin/variants/${vid}`, { method: 'DELETE' });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to delete variant');
    }
  }

  const hasOptions = product.options.length > 0;

  return (
    <Card title={`Variants (${product.variants.length})`}>
      {product.variants.length === 0 && (
        <p className="text-sm text-[color:var(--color-text-muted)]">No variants yet.</p>
      )}
      <div className="space-y-2">
        {product.variants.map((v) => (
          <VariantRow
            key={v.id}
            product={product}
            variant={v}
            onChanged={onChanged}
            onError={onError}
            onDelete={() => del(v.id)}
          />
        ))}
      </div>
      {hasOptions && (
        <AddVariantForm product={product} onChanged={onChanged} onError={onError} />
      )}
    </Card>
  );
}

function describeVariant(product: Product, v: ProductVariant): string {
  if (product.options.length === 0) return 'Default';
  return product.options
    .map((o) => {
      const valId = v.optionValues[o.id];
      const val = o.values.find((x) => x.id === valId);
      return val?.value ?? '?';
    })
    .join(' / ');
}

function VariantRow({
  product,
  variant,
  onChanged,
  onError,
  onDelete,
}: {
  product: Product;
  variant: ProductVariant;
  onChanged: () => void;
  onError: (s: string) => void;
  onDelete: () => void;
}) {
  const [sku, setSku] = useState(variant.sku);
  const [price, setPrice] = useState((variant.priceCents / 100).toFixed(2));
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api(`/api/admin/variants/${variant.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          sku,
          barcode: variant.barcode,
          priceCents: Math.round(parseFloat(price || '0') * 100),
          weightGrams: variant.weightGrams,
          optionValues: variant.optionValues,
        }),
      });
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to save variant');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      data-testid="variant-row"
      data-variant-label={describeVariant(product, variant)}
      className="grid grid-cols-[1.5fr_1fr_1fr_auto_auto] gap-2 items-center border border-[color:var(--color-border)] rounded p-2 text-sm"
    >
      <div className="font-medium">{describeVariant(product, variant)}</div>
      <input
        placeholder="SKU"
        value={sku}
        onChange={(e) => setSku(e.target.value)}
        className="px-2 py-1 rounded border border-[color:var(--color-border)]"
      />
      <input
        placeholder="Price"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        className="px-2 py-1 rounded border border-[color:var(--color-border)]"
      />
      <button
        onClick={save}
        disabled={saving}
        className="px-2 py-1 rounded border border-[color:var(--color-border)] hover:bg-gray-50 disabled:opacity-50"
      >
        {saving ? '…' : 'Save'}
      </button>
      <button onClick={onDelete} className="px-2 py-1 text-xs text-red-700 hover:underline">
        Delete
      </button>
    </div>
  );
}

function AddVariantForm({
  product,
  onChanged,
  onError,
}: {
  product: Product;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('0.00');

  async function add() {
    for (const o of product.options) {
      if (!values[o.id]) {
        onError(`Select a value for ${o.name}`);
        return;
      }
    }
    try {
      await api(`/api/admin/products/${product.id}/variants`, {
        method: 'POST',
        body: JSON.stringify({
          sku,
          barcode: '',
          priceCents: Math.round(parseFloat(price || '0') * 100),
          weightGrams: 0,
          optionValues: values,
        }),
      });
      setValues({});
      setSku('');
      setPrice('0.00');
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to add variant');
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-[color:var(--color-border)] space-y-2">
      <div className="text-xs uppercase tracking-wide text-[color:var(--color-text-muted)]">
        Add variant
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
        {product.options.map((o) => (
          <select
            key={o.id}
            value={values[o.id] || ''}
            onChange={(e) => setValues({ ...values, [o.id]: e.target.value })}
            className="px-2 py-1 text-sm rounded border border-[color:var(--color-border)] bg-white"
          >
            <option value="">{o.name}…</option>
            {o.values.map((v) => (
              <option key={v.id} value={v.id}>
                {v.value}
              </option>
            ))}
          </select>
        ))}
        <input
          placeholder="SKU"
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          className="px-2 py-1 text-sm rounded border border-[color:var(--color-border)]"
        />
        <input
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="px-2 py-1 text-sm rounded border border-[color:var(--color-border)]"
        />
        <button
          onClick={add}
          className="px-2 py-1 text-sm rounded bg-gray-900 text-white hover:bg-gray-800"
        >
          Add variant
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}

// formatPrice referenced elsewhere; prevent dead-code warnings in strict setups.
void formatPrice;
