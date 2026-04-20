'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { resetIdentity } from '@/lib/analytics';
import { formatPrice, type CustomerProfile, type MyOrderListItem, type SavedAddress } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

const FIN_BADGE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  paid: 'bg-green-100 text-green-800',
  refunded: 'bg-red-100 text-red-800',
  partially_refunded: 'bg-red-100 text-red-800',
};

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<MyOrderListItem[]>([]);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  async function load() {
    try {
      const [p, o, a] = await Promise.all([
        api<CustomerProfile>('/api/customer/profile'),
        api<MyOrderListItem[]>('/api/customer/orders'),
        api<SavedAddress[]>('/api/customer/addresses'),
      ]);
      setProfile(p);
      setOrders(o);
      setAddresses(a);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Load failed');
    }
  }
  useEffect(() => { load(); }, []);

  async function logout() {
    try { await api('/api/customer/auth/logout', { method: 'POST' }); }
    finally {
      resetIdentity();
      router.replace('/account/login');
      router.refresh();
    }
  }

  if (!profile) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-[color:var(--color-text-muted)]">Loading…</p>
        {error && <div className="mt-3 text-red-700 text-sm">{error}</div>}
      </section>
    );
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim() || profile.email;

  return (
    <section className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-semibold">Hello, {name}</h1>
        <button onClick={logout} className="text-sm text-[color:var(--color-text-muted)] hover:underline">
          Sign out
        </button>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">{error}</div>}

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          {/* Store credit */}
          {profile.storeCreditCents > 0 && (
            <div className="rounded border border-green-200 bg-green-50 p-4 text-sm flex items-center justify-between">
              <div>
                <div className="font-medium">Store credit available</div>
                <div className="text-xs text-green-800">
                  Automatically applied at checkout.
                </div>
              </div>
              <div className="text-xl font-semibold text-green-800">
                {formatPrice(profile.storeCreditCents, profile.storeCreditCurrency)}
              </div>
            </div>
          )}

          <Card title={`Orders (${orders.length})`}>
            {orders.length === 0 ? (
              <p className="text-sm text-[color:var(--color-text-muted)]">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-[color:var(--color-border)] text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 py-2">
                    <Link href={`/account/orders/${o.id}`} className="font-medium hover:underline">
                      {o.number}
                    </Link>
                    <span className={`text-xs rounded px-2 py-0.5 ${FIN_BADGE[o.financialStatus] ?? 'bg-gray-100 text-gray-800'}`}>
                      {o.financialStatus.replace('_', ' ')}
                    </span>
                    <span className="flex-1 text-xs text-[color:var(--color-text-muted)]">
                      {new Date(o.createdAt).toLocaleDateString()} · {o.itemsCount} items
                    </span>
                    <span className="font-medium">{formatPrice(o.totalCents, o.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Addresses (${addresses.length})`}>
            <AddressesEditor addresses={addresses} onChanged={load} />
          </Card>
        </div>

        <aside className="space-y-4 text-sm">
          <Card title="Profile">
            {!editingProfile ? (
              <div className="space-y-1">
                <div>{profile.firstName} {profile.lastName}</div>
                <div className="text-[color:var(--color-text-muted)]">{profile.email}</div>
                {profile.phone && <div className="text-[color:var(--color-text-muted)]">{profile.phone}</div>}
                <div className="text-xs text-[color:var(--color-text-muted)] pt-2">
                  Marketing emails: {profile.marketingConsent ? 'yes' : 'no'}
                </div>
                <button
                  onClick={() => setEditingProfile(true)}
                  className="mt-2 text-xs px-3 py-1 rounded border border-[color:var(--color-border)] hover:bg-gray-50"
                >
                  Edit
                </button>
              </div>
            ) : (
              <ProfileEdit profile={profile} onDone={async () => { setEditingProfile(false); await load(); }} saving={saving} setSaving={setSaving} setError={setError} />
            )}
          </Card>

          <PrivacyCard />
        </aside>
      </div>
    </section>
  );
}

function PrivacyCard() {
  const [eraseOpen, setEraseOpen] = useState(false);
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-2">
      <h2 className="text-sm font-semibold">Privacy</h2>
      <p className="text-xs text-[color:var(--color-text-muted)]">
        Your rights under the GDPR.
      </p>
      <a
        href={`${API}/api/customer/data-export`}
        className="block px-3 py-1.5 text-xs rounded border border-[color:var(--color-border)] text-center hover:bg-gray-50"
        target="_blank"
        rel="noreferrer"
      >
        Download my data
      </a>
      <button
        onClick={() => setEraseOpen(true)}
        className="w-full px-3 py-1.5 text-xs rounded border border-red-300 text-red-700 hover:bg-red-50"
      >
        Delete my account
      </button>
      {eraseOpen && <SelfEraseModal onClose={() => setEraseOpen(false)} />}
    </div>
  );
}

function SelfEraseModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await api('/api/customer/account/erase', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      router.replace('/account/login?erased=1');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Deletion failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3 text-sm">
        <h2 className="font-semibold text-red-800">Delete your account</h2>
        <p className="text-xs text-[color:var(--color-text-muted)]">
          This will anonymize your profile and delete your addresses and saved preferences.
          Your past orders will be retained for tax and legal reasons, but all personal
          information on them will be removed. This cannot be undone.
        </p>
        {error && <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">{error}</div>}
        <label className="block">
          <div className="font-medium mb-1">Re-enter your password to confirm</div>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 rounded border border-[color:var(--color-border)]">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting || password.length < 8}
            className="px-3 py-2 rounded bg-red-700 text-white disabled:opacity-50"
          >
            {submitting ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function ProfileEdit({
  profile, onDone, saving, setSaving, setError,
}: {
  profile: CustomerProfile;
  onDone: () => void;
  saving: boolean;
  setSaving: (b: boolean) => void;
  setError: (s: string | null) => void;
}) {
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [phone, setPhone] = useState(profile.phone);
  const [marketing, setMarketing] = useState(profile.marketingConsent);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api('/api/customer/profile', {
        method: 'PUT',
        body: JSON.stringify({ firstName, lastName, phone, marketingConsent: marketing }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }
  const input = 'w-full px-3 py-1.5 rounded border border-[color:var(--color-border)] text-sm';
  return (
    <div className="space-y-2">
      <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
      <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
      <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
        Email me about promotions and news
      </label>
      <button onClick={save} disabled={saving} className="w-full px-3 py-1.5 rounded bg-[color:var(--color-accent)] text-white text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function AddressesEditor({ addresses, onChanged }: { addresses: SavedAddress[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Partial<SavedAddress> | null>(null);

  async function del(id: string) {
    if (!confirm('Delete this address?')) return;
    try {
      await api(`/api/customer/addresses/${id}`, { method: 'DELETE' });
      await onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }
  async function save(addr: Partial<SavedAddress>) {
    try {
      const body = JSON.stringify(addr);
      if (addr.id) {
        await api(`/api/customer/addresses/${addr.id}`, { method: 'PUT', body });
      } else {
        await api(`/api/customer/addresses`, { method: 'POST', body });
      }
      setEditing(null);
      await onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-3">
      {addresses.length === 0 && <p className="text-sm text-[color:var(--color-text-muted)]">No addresses saved yet.</p>}
      {addresses.map((a) => (
        <div key={a.id} className="border border-[color:var(--color-border)] rounded p-3 text-sm flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {a.label && <span className="font-medium">{a.label}</span>}
              {a.isDefaultShipping && <span className="text-xs rounded bg-green-100 text-green-800 px-1.5 py-0.5">Default shipping</span>}
              {a.isDefaultBilling && <span className="text-xs rounded bg-blue-100 text-blue-800 px-1.5 py-0.5">Default billing</span>}
            </div>
            <div className="text-xs text-[color:var(--color-text-muted)]">
              {a.firstName} {a.lastName} · {a.addressLine1}, {a.postalCode} {a.city}, {a.country}
            </div>
          </div>
          <button onClick={() => setEditing(a)} className="text-xs hover:underline">Edit</button>
          <button onClick={() => del(a.id)} className="text-xs text-red-700 hover:underline">Delete</button>
        </div>
      ))}
      <button
        onClick={() => setEditing({
          label: '', firstName: '', lastName: '', company: '',
          addressLine1: '', addressLine2: '', city: '', region: '',
          postalCode: '', country: 'FR', phone: '',
          isDefaultShipping: addresses.length === 0, isDefaultBilling: addresses.length === 0,
        })}
        className="w-full px-3 py-1.5 rounded border border-[color:var(--color-border)] text-sm hover:bg-gray-50"
      >
        + Add address
      </button>

      {editing && <AddressModal value={editing} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function AddressModal({
  value, onClose, onSave,
}: {
  value: Partial<SavedAddress>;
  onClose: () => void;
  onSave: (a: Partial<SavedAddress>) => Promise<void>;
}) {
  const [v, setV] = useState(value);
  const set = (k: keyof SavedAddress) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setV({ ...v, [k]: e.target.value });
  const cls = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)] text-sm';
  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl p-4 space-y-3">
        <h2 className="text-sm font-semibold">{v.id ? 'Edit address' : 'New address'}</h2>
        <input className={cls} value={v.label ?? ''} onChange={set('label')} placeholder="Label (Home, Office…)" />
        <div className="grid grid-cols-2 gap-2">
          <input className={cls} required value={v.firstName ?? ''} onChange={set('firstName')} placeholder="First name" />
          <input className={cls} required value={v.lastName ?? ''} onChange={set('lastName')} placeholder="Last name" />
        </div>
        <input className={cls} value={v.company ?? ''} onChange={set('company')} placeholder="Company (optional)" />
        <input className={cls} required value={v.addressLine1 ?? ''} onChange={set('addressLine1')} placeholder="Address line 1" />
        <input className={cls} value={v.addressLine2 ?? ''} onChange={set('addressLine2')} placeholder="Address line 2" />
        <div className="grid grid-cols-[1fr_120px_120px] gap-2">
          <input className={cls} required value={v.city ?? ''} onChange={set('city')} placeholder="City" />
          <input className={cls} required value={v.postalCode ?? ''} onChange={set('postalCode')} placeholder="Postal code" />
          <input className={cls + ' uppercase'} required maxLength={2}
            value={v.country ?? 'FR'} onChange={(e) => setV({ ...v, country: e.target.value.toUpperCase() })}
            placeholder="FR" />
        </div>
        <input className={cls} value={v.phone ?? ''} onChange={set('phone')} placeholder="Phone" />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!v.isDefaultShipping} onChange={(e) => setV({ ...v, isDefaultShipping: e.target.checked })} />
          Default shipping address
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={!!v.isDefaultBilling} onChange={(e) => setV({ ...v, isDefaultBilling: e.target.checked })} />
          Default billing address
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)]">Cancel</button>
          <button onClick={() => onSave(v)} className="px-3 py-2 text-sm rounded bg-[color:var(--color-accent)] text-white">Save</button>
        </div>
      </div>
    </div>
  );
}
