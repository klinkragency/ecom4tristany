'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { BasicsSection } from './shared/BasicsSection';
import { SortOrderSection } from './shared/SortOrderSection';
import { RulesSection } from './shared/RulesSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { CollectionPayload, RuleInput } from './shared/types';

type Mode = 'create' | 'edit';

type CreateResp = { id: string };

// Rules with no value (other than valueless ops) should not be persisted,
// because the backend rejects them. We filter at save time so the form
// can stay free-form during edit.
function valueless(op: RuleInput['operator']): boolean {
  return op === 'in_stock' || op === 'out_of_stock';
}
function persistableRules(rules: RuleInput[]): RuleInput[] {
  return rules.filter((r) => valueless(r.operator) || r.value.trim().length > 0);
}

export default function SmartCollectionForm({
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

  const update = (patch: Partial<CollectionPayload>) =>
    setV((cur) => ({ ...cur, ...patch }));
  const Illustration = illustrationFor('smart');
  const disabled = v.title.trim().length === 0;

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      const basics = {
        title: v.title,
        handle: v.handle,
        descriptionHtml: v.descriptionHtml,
        isRulesBased: true,
        matchAll: v.matchAll,
        // Smart collections never use "manual" sort.
        sortOrder: v.sortOrder === 'manual' ? 'created_desc' : v.sortOrder,
      };
      const newRules = persistableRules(v.rules);
      let collectionId = id;
      if (mode === 'create') {
        const c = await api<CreateResp>('/api/admin/collections', {
          method: 'POST',
          body: JSON.stringify(basics),
        });
        collectionId = c.id;
        for (const rule of newRules) {
          await api(`/api/admin/collections/${collectionId}/rules`, {
            method: 'POST',
            body: JSON.stringify({
              field: rule.field,
              operator: rule.operator,
              value: rule.value,
            }),
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
        // The server has no rule-batch endpoint and no edit-rule endpoint,
        // so we delete every persisted rule and re-insert the new set. Same
        // strategy as the previous edit page; matches existing behaviour.
        for (const old of initial.rules) {
          if (!old.id) continue;
          await api(`/api/admin/rules/${old.id}`, { method: 'DELETE' });
        }
        for (const rule of newRules) {
          await api(`/api/admin/collections/${collectionId}/rules`, {
            method: 'POST',
            body: JSON.stringify({
              field: rule.field,
              operator: rule.operator,
              value: rule.value,
            }),
          });
        }
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
    <PageLayout preview={<LivePreview values={v} type="smart" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Let products self-organize"
        subtitle="Define conditions and the catalog populates this collection automatically."
        badge={mode === 'edit' ? 'Type: Smart collection' : undefined}
      />
      <BasicsSection values={v} onChange={update} />
      <RulesSection values={v} onChange={update} />
      <SortOrderSection values={v} onChange={update} isRulesBased={true} />
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
