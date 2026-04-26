'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageLayout } from './shared/PageLayout';
import { Header } from './shared/Header';
import { MethodSection } from './shared/MethodSection';
import { ValueSection } from './shared/ValueSection';
import { EligibilitySection, type Segment } from './shared/EligibilitySection';
import { LimitsSection, type Suggestions } from './shared/LimitsSection';
import { ScheduleSection } from './shared/ScheduleSection';
import { ActiveSection } from './shared/ActiveSection';
import { LivePreview } from './shared/LivePreview';
import { illustrationFor } from './shared/illustrations';
import type { DiscountPayload } from './shared/types';
import { hasErrors, validate } from './shared/validation';

type Mode = 'create' | 'edit';

export default function AmountOffOrderForm({
  initial,
  mode,
  id,
}: {
  initial: DiscountPayload;
  mode: Mode;
  id?: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<DiscountPayload>(initial);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions>(null);
  const [saving, setSaving] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [s, sug] = await Promise.all([
          api<{ items: Segment[] }>('/api/admin/segments').catch(() => ({ items: [] })),
          api<Suggestions>('/api/admin/discounts/suggestions').catch(() => null),
        ]);
        setSegments(s.items ?? []);
        setSuggestions(sug);
      } catch { /* ignore */ }
    })();
  }, []);

  const update = (patch: Partial<DiscountPayload>) => setV({ ...v, ...patch });
  const issues = validate(v, 'amount-off-order');
  const Illustration = illustrationFor('amount-off-order');

  async function save() {
    setSaving(true);
    setTopError(null);
    try {
      if (mode === 'create') {
        await api('/api/admin/discounts', { method: 'POST', body: JSON.stringify(v) });
      } else {
        await api(`/api/admin/discounts/${id}`, { method: 'PUT', body: JSON.stringify(v) });
      }
      router.push('/discounts');
    } catch (err) {
      setTopError(err instanceof ApiError ? err.message : 'Save failed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageLayout preview={<LivePreview values={v} type="amount-off-order" />}>
      {topError && <div className="alert alert-error">{topError}</div>}
      <Header
        illustration={<Illustration />}
        title="Take an amount off the cart total"
        subtitle="A simple promo that applies to the entire order subtotal."
        badge={mode === 'edit' ? 'Type: Amount off order' : undefined}
      />
      <MethodSection values={v} onChange={update} issues={issues} />
      <ValueSection values={v} onChange={update} issues={issues} />
      <EligibilitySection values={v} onChange={update} segments={segments} />
      <LimitsSection values={v} onChange={update} suggestions={suggestions} />
      <ScheduleSection values={v} onChange={update} issues={issues} />
      <ActiveSection
        values={v}
        onChange={update}
        saving={saving}
        saveLabel={mode === 'create' ? 'Create discount' : 'Save changes'}
        onSave={save}
        disabled={hasErrors(issues)}
      />
    </PageLayout>
  );
}
