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
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Products</h1>
        <div className="flex items-center gap-2">
          <a
            href={`${API}/api/admin/catalog/exports/products`}
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50"
            download
          >
            Export CSV
          </a>
          <button
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
            className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)] hover:bg-gray-50 disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Import CSV'}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onImportFile}
          />
          <Link
            href="/products/new"
            className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)]"
          >
            Add product
          </Link>
        </div>
      </div>

      {importResult && (
        <div className="mb-3 rounded border border-[color:var(--color-border)] bg-white p-3 text-sm">
          <div className="font-medium mb-1">Import complete</div>
          <div className="text-[color:var(--color-text-muted)]">
            {importResult.rows} rows · {importResult.productsCreated} created /
            {' '}{importResult.productsUpdated} updated · variants
            {' '}{importResult.variantsCreated} created / {importResult.variantsUpdated} updated
            {' '}· {importResult.errors.length} error{importResult.errors.length === 1 ? '' : 's'}
          </div>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-700">
              {importResult.errors.slice(0, 10).map((e, i) => (
                <li key={i}>
                  row {e.row}{e.handle ? ` (${e.handle})` : ''}: {e.message}
                </li>
              ))}
              {importResult.errors.length > 10 && (
                <li>… and {importResult.errors.length - 10} more</li>
              )}
            </ul>
          )}
          <button
            onClick={() => setImportResult(null)}
            className="mt-2 text-xs text-[color:var(--color-text-muted)] hover:underline"
          >
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
          className="w-80 px-3 py-2 rounded border border-[color:var(--color-border)]"
        />
      </form>

      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="rounded border border-[color:var(--color-border)] bg-white overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Variants</th>
              <th className="px-3 py-2 font-medium">Price</th>
              <th className="px-3 py-2 font-medium">Vendor</th>
              <th className="px-3 py-2 font-medium">Updated</th>
            </tr>
          </thead>
          <tbody>
            {!page && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {page && page.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-[color:var(--color-text-muted)]">
                  No products yet.
                </td>
              </tr>
            )}
            {page?.items.map((p) => (
              <tr key={p.id} className="border-t border-[color:var(--color-border)] hover:bg-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                    {p.title}
                  </Link>
                  <div className="text-xs text-[color:var(--color-text-muted)]">{p.handle}</div>
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={p.status} />
                </td>
                <td className="px-3 py-2">{p.variantCount}</td>
                <td className="px-3 py-2">
                  {p.minPriceCents === p.maxPriceCents
                    ? formatPrice(p.minPriceCents)
                    : `${formatPrice(p.minPriceCents)} – ${formatPrice(p.maxPriceCents)}`}
                </td>
                <td className="px-3 py-2">{p.vendor || '—'}</td>
                <td className="px-3 py-2 text-[color:var(--color-text-muted)]">
                  {new Date(p.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const styles = {
    active: 'bg-green-100 text-green-800',
    draft: 'bg-gray-100 text-gray-800',
    archived: 'bg-amber-100 text-amber-800',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
