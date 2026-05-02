'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';

// Lightweight grant/adjust dialog used from the customers list. The detail
// page has a richer version inline; we mirror the same backend contract
// (POST /api/admin/customers/{id}/store-credit with amountCents+reason+note).
export function GrantCreditDialog({
  open,
  customerId,
  customerLabel,
  currency = 'EUR',
  onClose,
  onDone,
}: {
  open: boolean;
  customerId: string;
  customerLabel: string;
  currency?: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [amount, setAmount] = useState('10.00');
  const [reason, setReason] = useState('grant');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    const cents = Math.round(parseFloat(amount) * 100);
    if (isNaN(cents) || cents === 0) {
      setErr('Enter a non-zero amount (negative to debit)');
      setBusy(false);
      return;
    }
    try {
      await api(`/api/admin/customers/${customerId}/store-credit`, {
        method: 'POST',
        body: JSON.stringify({ amountCents: cents, reason, note }),
      });
      await onDone();
      // Reset on success so reopening is clean.
      setAmount('10.00');
      setReason('grant');
      setNote('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Grant failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Grant store credit · ${customerLabel}`}
      size="sm"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="btn btn-primary disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </>
      }
    >
      {err && <div className="alert alert-error text-xs">{err}</div>}
      <label className="block">
        <span className="label">Amount ({currency}) — negative to debit</span>
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="input"
        />
      </label>
      <label className="block">
        <span className="label">Reason</span>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="select"
        >
          <option value="grant">Grant (compensation / goodwill)</option>
          <option value="promotional">Promotional (birthday, etc.)</option>
          <option value="adjustment">Adjustment (correction)</option>
          <option value="refund">Refund-to-credit</option>
          <option value="expiration">Expiration (debit)</option>
        </select>
      </label>
      <label className="block">
        <span className="label">Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="input"
        />
      </label>
    </Modal>
  );
}
