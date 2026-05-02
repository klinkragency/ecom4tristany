'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { formatPrice, type Product, type ProductListItem, type ProductListPage, type ProductStatus } from '@/lib/types';
import { ConfirmDialog, EntitySearchInput, RowActionsMenu } from '@/components/ui';
import { storefrontUrl } from '@/lib/storefront';

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
  const router = useRouter();
  const [page, setPage] = useState<ProductListPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ProductListItem | null>(null);

  async function setStatus(p: ProductListItem, status: ProductStatus) {
    if (p.status === status) return;
    setBusyId(p.id);
    setError(null);
    try {
      const full = await api<Product>(`/api/admin/products/${p.id}`);
      await api(`/api/admin/products/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: full.title,
          handle: full.handle,
          descriptionHtml: full.descriptionHtml,
          status,
          vendor: full.vendor,
          productType: full.productType,
          tags: full.tags,
          seoTitle: full.seoTitle,
          seoDescription: full.seoDescription,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    await api(`/api/admin/products/${toDelete.id}`, { method: 'DELETE' });
    setToDelete(null);
    await load();
  }

  async function load() {
    try {
      const data = await api<ProductListPage>(`/api/admin/products?limit=25`);
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
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
          <div className="text-stone-500">
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

      <div className="mb-4 w-80">
        <EntitySearchInput
          kinds={['product']}
          placeholder="Search products…"
        />
      </div>

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
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {page.items.map((p) => (
              <tr key={p.id} className={busyId === p.id ? 'opacity-60' : ''}>
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
                <td>
                  <RowActionsMenu
                    label={`Actions for ${p.title}`}
                    actions={[
                      {
                        label: 'Edit',
                        onClick: () => router.push(`/products/${p.id}`),
                      },
                      {
                        label: 'Set status: Active',
                        onClick: () => setStatus(p, 'active'),
                        disabled: p.status === 'active' || busyId === p.id,
                      },
                      {
                        label: 'Set status: Draft',
                        onClick: () => setStatus(p, 'draft'),
                        disabled: p.status === 'draft' || busyId === p.id,
                      },
                      {
                        label: 'Set status: Archived',
                        onClick: () => setStatus(p, 'archived'),
                        disabled: p.status === 'archived' || busyId === p.id,
                      },
                      {
                        label: 'View on storefront',
                        onClick: () =>
                          window.open(
                            `${storefrontUrl()}/products/${p.handle}`,
                            '_blank',
                            'noopener,noreferrer',
                          ),
                      },
                      {
                        label: 'Delete',
                        destructive: true,
                        onClick: () => setToDelete(p),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete product?"
        description="This cannot be undone. Variants and inventory levels are removed too."
        confirmLabel="Delete product"
        destructive
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
      />
    </section>
  );
}

function StatusPill({ status }: { status: 'draft' | 'active' | 'archived' }) {
  const cls = status === 'active' ? 'badge-success' : status === 'archived' ? 'badge-warning' : 'badge-neutral';
  return <span className={`badge ${cls}`}>{status}</span>;
}
