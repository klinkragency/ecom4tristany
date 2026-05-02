'use client';

import { useState } from 'react';
import { Modal, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Created = { id: string; email: string; inviteSent: boolean };

export function NewCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Created) => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [sendInvite, setSendInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setFirstName('');
    setLastName('');
    setPhone('');
    setSendInvite(false);
    setErr(null);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const c = await api<Created>('/api/admin/customers', {
        method: 'POST',
        body: JSON.stringify({ email, firstName, lastName, phone, sendInvite }),
      });
      reset();
      onCreated(c);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="New customer"
      size="md"
      footer={
        <>
          <button type="button" onClick={close} disabled={busy} className="btn">
            Cancel
          </button>
          <button
            type="submit"
            form="new-customer-form"
            disabled={busy || !email}
            className="btn btn-primary disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create customer'}
          </button>
        </>
      }
    >
      <form id="new-customer-form" onSubmit={submit} className="space-y-3">
        <Field label="Email" required>
          <input
            type="email"
            required
            autoFocus
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="customer@example.com"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </Field>
          <Field label="Last name">
            <input
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Phone">
          <input
            className="input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+33 …"
          />
        </Field>
        <label className="flex items-start gap-2 cursor-pointer rounded-md border border-stone-200 p-3 hover:bg-stone-50">
          <input
            type="checkbox"
            checked={sendInvite}
            onChange={(e) => setSendInvite(e.target.checked)}
            className="mt-0.5"
          />
          <span className="text-sm">
            <span className="font-medium block">Send a password setup email</span>
            <span className="text-xs text-stone-500">
              The customer gets an email with a link to set their password and log in. The link expires in 1 hour.
            </span>
          </span>
        </label>
        {!sendInvite && (
          <p className="text-xs text-stone-500">
            The account is created without a usable password. The customer can request a reset themselves later if needed.
          </p>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>
    </Modal>
  );
}
