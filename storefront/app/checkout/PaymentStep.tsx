'use client';

import { useState } from 'react';
import { PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { formatPrice } from '@/lib/types';

export default function PaymentStep({
  orderId,
  totalCents,
  currency,
  onBack,
}: {
  orderId: string;
  totalCents: number;
  currency: string;
  onBack: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const returnUrl = `${window.location.origin}/checkout/success?orderId=${encodeURIComponent(orderId)}`;
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });
    // If confirmPayment returns an error, it's a validation / payment-method error.
    // Otherwise Stripe redirects to the return_url.
    if (err) {
      setError(err.message ?? 'Payment failed');
    }
    setPaying(false);
  }

  return (
    <form onSubmit={pay} className="space-y-4">
      <div className="rounded border border-[color:var(--color-border)] bg-white p-4">
        <h2 className="text-sm font-semibold mb-3">Payment</h2>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {error && (
        <div className="rounded border border-red-200 bg-red-50 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} className="px-3 py-2 text-sm rounded border border-[color:var(--color-border)]">
          ← Edit address
        </button>
        <button
          type="submit"
          disabled={!stripe || paying}
          className="flex-1 px-4 py-3 rounded bg-[color:var(--color-accent)] text-white hover:bg-[color:var(--color-accent-hover)] disabled:opacity-50"
        >
          {paying ? 'Processing…' : `Pay ${formatPrice(totalCents, currency)}`}
        </button>
      </div>
    </form>
  );
}
