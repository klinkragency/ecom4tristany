'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { DiscountTypeModal } from './DiscountTypeModal';

export function CreateDiscountButton() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      router.replace('/discounts');
    }
  }, [params, router]);
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        + New discount
      </button>
      <DiscountTypeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
