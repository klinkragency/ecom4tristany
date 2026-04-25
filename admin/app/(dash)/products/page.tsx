'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type ProductListPage } from '@/lib/types';

type ImportResult = {
  rows: number;
  productsCreated: number;
  productsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  errors: { row: number; handle?: string; message: string }[];
};

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export default function ProductsListPage() {
  const [page, setPage] = useState<ProductListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function load(q = '') {
    try {
      const data = await api<ProductListPage>(
        `/api/admin/products?limit=25${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      );
      setPage(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      // Fetch a CSRF token then POST the file directly (multipart).
      const tokRes = await fetch(`${API}/api/csrf`, { credentials: 'include' });
      const { csrfToken } = (await tokRes.json()) as { csrfToken: string };
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API}/api/admin/catalog/imports/products`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': csrfToken },
        body: form,
      });
      const body = (await res.json().catch(() => ({}))) as
        | ImportResult
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      setImportResult(body as ImportResult);
      await load(search);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  return (
    <section>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="h-page">Products</h1>
        <div className="flex items-center gap-2">
          <a href={`${API}/api/admin/catalog/exports/products`} className="btn btn-secondary" download>
            Export CSV
          </a>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="btn btn-secondary"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <input ref={importInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onImportFile} />
          <Link href="/products/new" className="btn btn-primary">
            Add product
          </Link>
        </div>
      </div>

      {importResult && (
        <div className="card card-pad mb-4 text-sm">
          <div className="mb-1 font-medium">Import complete</div>
          <div className="text-[color:var(--color-text-muted)]">
            {importResult.rows} rows · {importResult.productsCreated} created / {importResult.productsUpdated} updated ·
            variants {importResult.variantsCreated} created / {importResult.variantsUpdated} updated ·{' '}
            {importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-700">
              {importResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  row {e.row}{e.handle ? ` (${e.handle})` : ''}: {e.message}
                </li>
              ))}
              {importResult.errors.length > 10 && <li>… and {importResult.errors.length - 10} more</li>}
            </ul>
          )}
          <button onClick={() => setImportResult(null)} className="btn btn-ghost btn-sm mt-2">
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={onSearch} className="mb-4">
        <input
          type="search"
          placeholder="Search title, handle, vendor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input w-80"
        />
      </form>

      {error && <div className="alert alert-error mb-4">{error}</div>}

      {!page ? (
        <div className="empty">Loading…</div>
      ) : page.items.length === 0 ? (
        <div className="empty">No products yet.</div>
      ) : (
        <table className="table-card">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Variants</th>
              <th>Price</th>
              <th>Vendor</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <div className="text-xs text-stone-500">{p.handle}</div>
                </td>
                <td>
                  <StatusPill status={p.status} />
                </td>
                <td className="tabular-nums">{p.variantCount}</td>
                <td className="tabular-nums">
                  {p.minPriceCents === p.maxPriceCents
                    ? formatPrice(p.minPriceCents)
                    : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
                </td>
                <td>{p.vendor || <span className="text-stone-400">—</span>}</td>
                <td className="text-stone-500">{new Date(p.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function StatusPill({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const cls = status === 'active' ? 'badge-success' : status === 'archived' ? 'badge-warning' : 'badge-neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}
