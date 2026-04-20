'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { api, ApiError } from '@/lib/api';
import { cartStore, useCart } from '@/lib/cart-store';
import { formatPrice } from '@/lib/types';
import PaymentStep from './PaymentStep';

type InitResponse = {
  orderId: string;
  orderNumber: string;
  clientSecret: string;
  publishableKey: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};

type Address = {
  firstName: string;
  lastName: string;
  company: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone: string;
};

const EMPTY_ADDRESS: Address = {
  firstName: '', lastName: '', company: '',
  addressLine1: '', addressLine2: '',
  city: '', region: '', postalCode: '', country: 'FR', phone: '',
};

type QuotedRate = {
  id: string;
  name: string;
  kind: string;
  priceCents: number;
  free: boolean;
};

export default function CheckoutPage() {
  const router = useRouter();
  const { cart, loading } = useCart();

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [shipping, setShipping] = useState<Address>(EMPTY_ADDRESS);
  const [billing, setBilling] = useState<Address>(EMPTY_ADDRESS);
  const [sameAs, setSameAs] = useState(true);

  const [rates, setRates] = useState<QuotedRate[]>([]);
  const [selectedRateId, setSelectedRateId] = useState<string>('');
  const [ratesLoading, setRatesLoading] = useState(false);

  const [initResp, setInitResp] = useState<InitResponse | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Refresh shipping rates whenever the destination country changes.
  useEffect(() => {
    const country = shipping.country.trim().toUpperCase();
    if (country.length !== 2 || !cart || cart.items.length === 0) {
      setRates([]);
      return;
    }
    let cancelled = false;
    setRatesLoading(true);
    (async () => {
      try {
        const res = await api<{ rates: QuotedRate[] }>('/api/storefront/checkout/shipping-quote', {
          method: 'POST',
          body: JSON.stringify({ country }),
        });
        if (cancelled) return;
        setRates(res.rates);
        if (res.rates.length > 0 && !res.rates.find((r) => r.id === selectedRateId)) {
          setSelectedRateId(res.rates[0]!.id);
        } else if (res.rates.length === 0) {
          setSelectedRateId('');
        }
      } catch {
        if (!cancelled) setRates([]);
      } finally {
        if (!cancelled) setRatesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shipping.country, cart?.items.length]);

  // Redirect if cart is empty (only once we know).
  useEffect(() => {
    if (!loading && cart && cart.items.length === 0 && !initResp) {
      router.push('/cart');
    }
  }, [loading, cart, router, initResp]);

  async function continueToPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api<InitResponse>('/api/storefront/checkout/init', {
        method: 'POST',
        body: JSON.stringify({
          email,
          phone,
          shipping,
          billing: sameAs ? shipping : billing,
          billingSameAsShipping: sameAs,
          shippingRateId: selectedRateId || undefined,
        }),
      });
      setInitResp(res);
      setStripePromise(loadStripe(res.publishableKey));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start payment');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading && !cart) {
    return <section className="mx-auto max-w-4xl px-4 py-10"><p>Loading…</p></section>;
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-10 grid md:grid-cols-[1fr_360px] gap-8">
      <div>
        <div className="text-sm text-[color:var(--color-text-muted)] mb-2">
          <Link href="/cart" className="hover:underline">← Back to cart</Link>
        </div>
        <h1 className="text-3xl font-semibold mb-6">Checkout</h1>

        {error && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
            {error}
          </div>
        )}

        {!initResp && (
          <form onSubmit={continueToPayment} className="space-y-6">
            <Card title="Contact">
              <Field label="Email" required>
                <input
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
                />
              </Field>
              <Field label="Phone (optional)">
                <input
                  type="tel" value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded border border-[color:var(--color-border)]"
                />
              </Field>
            </Card>

            <Card title="Shipping address">
              <AddressForm value={shipping} onChange={setShipping} />
            </Card>

            <Card title="Billing address">
              <label className="flex items-center gap-2 text-sm mb-3">
                <input
                  type="checkbox"
                  checked={sameAs}
                  onChange={(e) => setSameAs(e.target.checked)}
                />
                Same as shipping
              </label>
              {!sameAs && <AddressForm value={billing} onChange={setBilling} />}
            </Card>

            <Card title="Shipping method">
              {ratesLoading ? (
                <p className="text-sm text-[color:var(--color-text-muted)]">Loading rates…</p>
              ) : rates.length === 0 ? (
                <p className="text-sm text-[color:var(--color-text-muted)]">
                  {shipping.country
                    ? `No shipping options configured for ${shipping.country} yet — a default €5 flat rate will be applied.`
                    : 'Enter a country to see shipping options.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {rates.map((r) => (
                    <li key={r.id}>
                      <label className="flex items-center gap-3 border border-[color:var(--color-border)] rounded px-3 py-2 cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="rate"
                          value={r.id}
                          checked={selectedRateId === r.id}
                          onChange={() => setSelectedRateId(r.id)}
                        />
                        <div className="flex-1">
                          <div className="font-medium text-sm">{r.name}</div>
                          {r.free && <div className="text-xs text-green-700">Free shipping applied</div>}
                        </div>
                        <div className="text-sm font-medium">{formatPrice(r.priceCents)}</div>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <button
              type="submit"
              disabled={submitting || !cart || cart.items.length === 0}
              className="w-full px-4 py-3 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
            >
              {submitting ? 'Preparing payment…' : 'Continue to payment'}
            </button>
          </form>
        )}

        {initResp && stripePromise && (
          <Elements stripe={stripePromise} options={{ clientSecret: initResp.clientSecret, appearance: { theme: 'stripe' } }}>
            <PaymentStep orderId={initResp.orderId} totalCents={initResp.totalCents} currency={initResp.currency} onBack={() => { setInitResp(null); setStripePromise(null); }} />
          </Elements>
        )}
      </div>

      <aside className="md:sticky md:top-4 self-start">
        <div className="rounded border border-[color:var(--color-border)] bg-white p-4 space-y-3 text-sm">
          <h2 className="font-semibold">Order summary</h2>
          <ul className="divide-y divide-[color:var(--color-border)]">
            {cart?.items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 py-2">
                <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden shrink-0">
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{it.productTitle}</div>
                  {it.variantTitle && <div className="text-xs text-[color:var(--color-text-muted)]">{it.variantTitle}</div>}
                  <div className="text-xs text-[color:var(--color-text-muted)]">qty {it.quantity}</div>
                </div>
                <div className="text-sm">{formatPrice(it.lineTotalCents)}</div>
              </li>
            ))}
          </ul>
          <div className="border-t border-[color:var(--color-border)] pt-2 space-y-1">
            <div className="flex justify-between">
              <span className="text-[color:var(--color-text-muted)]">Subtotal</span>
              <span>{formatPrice(initResp?.subtotalCents ?? cart?.subtotalCents ?? 0)}</span>
            </div>
            {initResp && (
              <div className="flex justify-between">
                <span className="text-[color:var(--color-text-muted)]">Shipping</span>
                <span>{formatPrice(initResp.shippingCents)}</span>
              </div>
            )}
            {initResp && (
              <div className="flex justify-between text-xs text-[color:var(--color-text-muted)]">
                <span>of which VAT</span>
                <span>{formatPrice(initResp.taxCents)}</span>
              </div>
            )}
            <div className="flex justify-between font-medium pt-1">
              <span>Total</span>
              <span>{formatPrice(initResp?.totalCents ?? cart?.subtotalCents ?? 0)}</span>
            </div>
            {!initResp && (
              <p className="text-xs text-[color:var(--color-text-muted)] pt-1">
                Shipping (flat €5) and VAT will be shown once you continue.
              </p>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-[color:var(--color-border)] bg-white p-4">
      <h2 className="text-sm font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <div className="text-sm font-medium mb-1">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </div>
      {children}
    </label>
  );
}

function AddressForm({ value, onChange }: { value: Address; onChange: (a: Address) => void }) {
  const set = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value });
  const input = 'w-full px-3 py-2 rounded border border-[color:var(--color-border)]';
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" required><input required className={input} value={value.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name" required><input required className={input} value={value.lastName} onChange={set('lastName')} /></Field>
      </div>
      <Field label="Company"><input className={input} value={value.company} onChange={set('company')} /></Field>
      <Field label="Address line 1" required><input required className={input} value={value.addressLine1} onChange={set('addressLine1')} /></Field>
      <Field label="Address line 2"><input className={input} value={value.addressLine2} onChange={set('addressLine2')} /></Field>
      <div className="grid grid-cols-[1fr_120px_120px] gap-3">
        <Field label="City" required><input required className={input} value={value.city} onChange={set('city')} /></Field>
        <Field label="Postal code" required><input required className={input} value={value.postalCode} onChange={set('postalCode')} /></Field>
        <Field label="Country (2-letter)" required>
          <input required maxLength={2} className={input + ' uppercase'} value={value.country}
                 onChange={(e) => onChange({ ...value, country: e.target.value.toUpperCase() })} />
        </Field>
      </div>
      <Field label="Region / State"><input className={input} value={value.region} onChange={set('region')} /></Field>
      <Field label="Phone"><input className={input} value={value.phone} onChange={set('phone')} /></Field>
    </div>
  );
}
