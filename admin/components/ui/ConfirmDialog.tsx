'use client';

import { useState, type ReactNode } from 'react';
import { Modal } from './Modal';

// Drop-in replacement for `window.confirm()` that matches the rest of the
// admin's visual language (uses our Modal, same typography, destructive
// red action button when `destructive=true`). The async `onConfirm` is
// awaited; errors surface inline rather than crashing the dialog.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setErr(null);
    try {
      await onConfirm();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Action failed');
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : () => { setErr(null); onCancel(); }}
      title={title}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={() => { setErr(null); onCancel(); }}
            disabled={busy}
            className="btn"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={
              destructive
                ? 'btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50'
                : 'btn btn-primary disabled:opacity-50'
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {description && <div className="text-sm text-stone-700">{description}</div>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Modal>
  );
}
