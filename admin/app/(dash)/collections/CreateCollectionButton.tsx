'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CollectionTypeModal } from './CollectionTypeModal';

export function CreateCollectionButton() {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Auto-open the modal when the user lands on /collections?new=1, then
  // strip the query so a refresh does not re-trigger it.
  useEffect(() => {
    if (params.get('new') === '1') {
      setOpen(true);
      router.replace('/collections');
    }
  }, [params, router]);
  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
      >
        + New collection
      </button>
      <CollectionTypeModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
