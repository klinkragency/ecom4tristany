'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { BasicsSection } from './shared/BasicsSection';
import { MatchModeSection } from './shared/MatchModeSection';
import { RulesSection } from './shared/RulesSection';
import { ActiveSection } from './shared/ActiveSection';
import { MembersPreview } from './shared/MembersPreview';
import { SegmentIllustration } from './shared/illustrations';
import {
  normalizeSegment,
  persistableRules,
  type SegmentPayload,
  type SegmentResponse,
} from './shared/types';

type Mode = 'create' | 'edit';

export default function SegmentForm({
  initial,
  mode,
  id,
}: {
  initial: SegmentPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<SegmentPayload>(initial);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  const update = (patch: Partial<SegmentPayload>) =>
    setV((cur) => ({ ...cur, ...patch }));

  const disabled = v.name.trim().length === 0;

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      // Re-index positions and drop blank-value rules so the backend doesn't
      // reject the payload for partially-filled drafts.
      const rules = persistableRules(v.rules).map((r, i) => ({
        field: r.field,
        operator: r.operator,
        value: r.value,
        position: i,
      }));
      const body = JSON.stringify({
        name: v.name.trim(),
        description: v.description,
        matchAll: v.matchAll,
        rules,
      });

      if (mode === 'create') {
        await api<SegmentResponse>('/api/admin/segments', {
          method: 'POST',
          body,
        });
        router.push('/segments');
      } else {
        if (!id) throw new Error('missing segment id');
        const res = await api<SegmentResponse>(`/api/admin/segments/${id}`, {
          method: 'PUT',
          body,
        });
        // Stay on the edit page after a successful save and refresh state
        // from the server response so any backend normalization (rule IDs
        // re-issued, positions clamped) shows up immediately.
        setV(normalizeSegment(res));
      }
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<MembersPreview values={v} />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<SegmentIllustration />}
        title="Group customers into a segment"
        subtitle={
          mode === 'create'
            ? 'Define conditions and save the result for reuse — works like a saved filter.'
            : 'Adjust the conditions and save your changes.'
        }
        badge={mode === 'edit' ? 'Edit' : undefined}
      />
      <BasicsSection values={v} onChange={update} />
      <MatchModeSection values={v} onChange={update} />
      <RulesSection values={v} onChange={update} />
      <ActiveSection
        saving={saving}
        saveLabel={mode === 'create' ? 'Create segment' : 'Save changes'}
        onSave={save}
        onCancel={() => router.push('/segments')}
        disabled={disabled}
      />
    </PageLayout>
  );
}
