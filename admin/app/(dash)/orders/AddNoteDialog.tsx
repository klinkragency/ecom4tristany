'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';

// Inline dialog wrapping a single textarea for `PUT /orders/{id}/note`.
export function AddNoteDialog({
  open,
  orderId,
  orderNumber,
  initial = '',
  onClose,
  onDone,
}: {
  open: boolean;
  orderId: string;
  orderNumber: string;
  initial?: string;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const [note, setNote] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync when the dialog opens for a different order.
  useEffect(() => {
    if (open) {
      setNote(initial);
      setErr(null);
    }
  }, [open, initial]);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/admin/orders/${orderId}/note`, {
        method: 'PUT',
        body: JSON.stringify({ note }),
      });
      await onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Note · ${orderNumber}`}
      size="md"
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
            {busy ? 'Saving…' : 'Save note'}
          </button>
        </>
      }
    >
      {err && <div className="alert alert-error text-xs">{err}</div>}
      <textarea
        rows={5}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Internal note for this order…"
        className="input text-sm"
      />
    </Modal>
  );
}
