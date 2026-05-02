'use client';

import { useState } from 'react';
import { Modal, Field } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Created = { id: string; email: string };

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setEmail('');
    setFirstName('');
    setLastName('');
    setPhone('');
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
        body: JSON.stringify({ email, firstName, lastName, phone }),
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
        <p className="text-xs text-stone-500">
          The customer will be created without a password. They can use the password reset
          flow if they want to log in to their account.
        </p>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </form>
    </Modal>
  );
}
