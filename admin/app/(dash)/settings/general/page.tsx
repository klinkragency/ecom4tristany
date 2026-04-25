'use client';

import { useEffect, useState } from 'react';
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
    return (
      <div>
        <p className="text-stone-500">Loading…</p>
        {error && <div className="alert alert-error mt-3">{error}</div>}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-3">
      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Saved.</div>}
      <div className="card card-pad space-y-4">
        <label className="block">
          <span className="label">Store name</span>
          <input className="input" value={v.shopName} onChange={(e) => setV({ ...v, shopName: e.target.value })} />
        </label>
        <label className="block">
          <span className="label">Public storefront URL</span>
          <input className="input" value={v.shopPublicUrl} onChange={(e) => setV({ ...v, shopPublicUrl: e.target.value })} />
          <span className="help">Used in emails, OG tags and the RSS feed.</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Currency (ISO 4217)</span>
            <input
              className="input uppercase"
              maxLength={3}
              value={v.shopCurrency}
              onChange={(e) => setV({ ...v, shopCurrency: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="block">
            <span className="label">VAT percent (tax-inclusive)</span>
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={v.shopVatPercent}
              onChange={(e) => setV({ ...v, shopVatPercent: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={save} disabled={saving} className="btn btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
