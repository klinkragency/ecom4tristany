'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';

type Settings = {
  shopName: string;
  shopPublicUrl: string;
  shopCurrency: string;
  shopVatPercent: number;
};

export default function GeneralSettingsPage() {
  const [v, setV] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setV(await api<Settings>('/api/admin/settings'));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Load failed');
      }
    })();
  }, []);

  async function save() {
    if (!v) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api<Settings>('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(v),
      });
      setV(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (!v) {
    return <section><p className="text-[color:var(--color-text-muted)]">Loading…</p>{error && <div className="text-red-700 text-sm mt-3">{error}</div>}</section>;
  }

  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)]';

  return (
    <section className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <Link href="/settings" className="text-sm text-[color:var(--color-text-muted)] hover:underline">← Settings</Link>
        <h1 className="text-2xl font-semibold">General</h1>
      </div>
      {error && <div className="mb-3 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}
      {saved && <div className="mb-3 rounded border border-green-200 bg-green-50 text-green-800 text-sm px-3 py-2">Saved.</div>}
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-4 text-sm">
        <label className="block">
          <div className="font-medium mb-1">Store name</div>
          <input className={input} value={v.shopName} onChange={(e) => setV({ ...v, shopName: e.target.value })} />
        </label>
        <label className="block">
          <div className="font-medium mb-1">Public storefront URL</div>
          <input className={input} value={v.shopPublicUrl} onChange={(e) => setV({ ...v, shopPublicUrl: e.target.value })} />
          <div className="text-xs text-[color:var(--color-text-muted)] mt-1">
            Used in emails, OG tags and the RSS feed.
          </div>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="font-medium mb-1">Currency (ISO 4217)</div>
            <input className={input + ' uppercase'} maxLength={3} value={v.shopCurrency}
              onChange={(e) => setV({ ...v, shopCurrency: e.target.value.toUpperCase() })} />
          </label>
          <label className="block">
            <div className="font-medium mb-1">VAT percent (tax-inclusive)</div>
            <input type="number" min={0} max={100} className={input}
              value={v.shopVatPercent}
              onChange={(e) => setV({ ...v, shopVatPercent: Number(e.target.value) })} />
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-4 py-2 rounded bg-[color:var(--color-accent)] text-white disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  );
}
