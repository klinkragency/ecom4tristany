'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/types';

export default function NewProductPage() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active'>('draft');
  const [vendor, setVendor] = useState('');
  const [productType, setProductType] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const p = await api<Product>('/api/admin/products', {
        method: 'POST',
        body: JSON.stringify({
          title,
          descriptionHtml: description,
          status,
          vendor,
          productType,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });
      router.push(`/products/${p.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="max-w-3xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/products" className="text-sm text-[color:var(--color-text-muted)] hover:underline">
          ← Products
        </Link>
        <h1 className="text-2xl font-semibold">New product</h1>
      </div>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Card title="Basic info">
          <Field label="Title">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
            />
          </Field>
          <Field label="Description (plain HTML; Tiptap coming in Phase 2c)">
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] font-mono text-sm"
              placeholder="<p>Soft cotton tee…</p>"
            />
          </Field>
        </Card>

        <Card title="Organization">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'draft' | 'active')}
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)] bg-white"
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
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
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="tee, summer, new"
                className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
              />
            </Field>
          </div>
        </Card>

        <div className="flex gap-2 justify-end">
          <Link
            href="/products"
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)]"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
          >
            {pending ? 'Creating…' : 'Create product'}
          </button>
        </div>
      </form>
    </section>
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
