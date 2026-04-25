'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { Product } from '@/lib/types';
import RichTextEditor from '@/components/RichTextEditor';
import { Card, Field } from '@/components/ui';

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
      <div className="mb-5 flex items-center gap-3">
        <Link href="/products" className="text-sm text-stone-500 hover:underline">← Products</Link>
        <h1 className="h-page">New product</h1>
      </div>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      <form onSubmit={onSubmit} className="space-y-4">
        <Card title="Basic info">
          <Field label="Title">
            <input required value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
          </Field>
          <Field label="Description">
            <RichTextEditor value={description} onChange={setDescription} placeholder="Describe the product…" minHeight={160} />
          </Field>
        </Card>

        <Card title="Organization">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'active')} className="select">
                <option value="draft">Draft</option>
                <option value="active">Active</option>
              </select>
            </Field>
            <Field label="Vendor">
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} className="input" />
            </Field>
            <Field label="Product type">
              <input value={productType} onChange={(e) => setProductType(e.target.value)} className="input" />
            </Field>
            <Field label="Tags (comma-separated)">
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tee, summer, new" className="input" />
            </Field>
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/products" className="btn btn-secondary">Cancel</Link>
          <button type="submit" disabled={pending} className="btn btn-primary">
            {pending ? 'Creating…' : 'Create product'}
          </button>
        </div>
      </form>
    </section>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
