'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { BasicsSection } from './shared/BasicsSection';
import { SortOrderSection } from './shared/SortOrderSection';
import { ManualProductsSection } from './shared/ManualProductsSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { CollectionPayload } from './shared/types';

type Mode = 'create' | 'edit';

type CreateResp = { id: string };

export default function ManualCollectionForm({
  initial,
  mode,
  id,
}: {
  initial: CollectionPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<CollectionPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const update = (patch: Partial<CollectionPayload>) => setV((cur) => ({ ...cur, ...patch }));
  const Illustration = illustrationFor('manual');
  const disabled = v.title.trim().length === 0;

  // Persist the basics first, then reconcile the product set. For create
  // mode we create the collection then bulk-attach. For edit mode we diff
  // the local list against the previous one.
  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      const basics = {
        title: v.title,
        handle: v.handle,
        descriptionHtml: v.descriptionHtml,
        isRulesBased: false,
        matchAll: v.matchAll,
        sortOrder: v.sortOrder,
      };
      let collectionId = id;
      if (mode === 'create') {
        const c = await api<CreateResp>('/api/admin/collections', {
          method: 'POST',
          body: JSON.stringify(basics),
        });
        collectionId = c.id;
        if (v.productIds.length > 0) {
          await api(`/api/admin/collections/${collectionId}/products`, {
            method: 'POST',
            body: JSON.stringify({ productIds: v.productIds }),
          });
        }
      } else {
        if (!collectionId) throw new Error('missing collection id');
        await api(`/api/admin/collections/${collectionId}`, {
          method: 'PUT',
          body: JSON.stringify({
            title: basics.title,
            handle: basics.handle,
            descriptionHtml: basics.descriptionHtml,
            matchAll: basics.matchAll,
            sortOrder: basics.sortOrder,
          }),
        });
        // Diff product list: detach removed, attach added.
        const before = new Set(initial.productIds);
        const after = new Set(v.productIds);
        const removed = [...before].filter((x) => !after.has(x));
        const added = [...after].filter((x) => !before.has(x));
        for (const pid of removed) {
          await api(`/api/admin/collections/${collectionId}/products/${pid}`, {
            method: 'DELETE',
          });
        }
        if (added.length > 0) {
          await api(`/api/admin/collections/${collectionId}/products`, {
            method: 'POST',
            body: JSON.stringify({ productIds: added }),
          });
        }
        // Always send the final order so manual sort is preserved.
        await api(`/api/admin/collections/${collectionId}/products/reorder`, {
          method: 'POST',
          body: JSON.stringify({ orderedProductIds: v.productIds }),
        });
      }
      router.push('/collections');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="manual" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Build a collection by hand"
        subtitle="Pick the products you want to feature, in the order you want."
        badge={mode === 'edit' ? 'Type: Manual collection' : undefined}
      />
      <BasicsSection values={v} onChange={update} />
      <ManualProductsSection values={v} onChange={update} />
      <SortOrderSection values={v} onChange={update} isRulesBased={false} />
      <ActiveSection
        saving={saving}
        saveLabel={mode === 'create' ? 'Create collection' : 'Save changes'}
        onSave={save}
        onCancel={() => router.push('/collections')}
        disabled={disabled}
      />
    </PageLayout>
  );
}
