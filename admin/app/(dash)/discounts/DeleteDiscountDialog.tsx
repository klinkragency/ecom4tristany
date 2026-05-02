'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui';

export function DeleteDiscountDialog({
  open,
  title,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title="Delete discount"
      size="sm"
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="btn">
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </>
      }
    >
      <p className="text-sm text-stone-700">
        Delete <span className="font-semibold">{title}</span>? This cannot be undone — past
        usage records keep the reference but the discount itself disappears from the list.
      </p>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Modal>
  );
}
