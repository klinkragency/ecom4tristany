'use client';

import { useState } from 'react';
import { DiscountTypeModal } from './DiscountTypeModal';

export function CreateDiscountButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        + New discount
      </button>
      <DiscountTypeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
