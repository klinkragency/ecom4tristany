'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import {
  collectionToTypeURL,
  normalizeCollection,
  type CollectionPayload,
  type CollectionResponse,
} from '../_forms/shared/types';
import ManualCollectionForm from '../_forms/ManualCollectionForm';
import SmartCollectionForm from '../_forms/SmartCollectionForm';

export default function EditCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [collection, setCollection] = useState<CollectionPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await api<CollectionResponse>(`/api/admin/collections/${id}`);
        setCollection(normalizeCollection(c));
      } catch {
        setMissing(true);
      }
    })();
  }, [id]);

  if (missing) notFound();
  if (!collection) return <div className="p-6 text-stone-500">Loading…</div>;

  const type = collectionToTypeURL(collection);
  switch (type) {
    case 'manual':
      return <ManualCollectionForm initial={collection} mode="edit" id={id} />;
    case 'smart':
      return <SmartCollectionForm initial={collection} mode="edit" id={id} />;
  }
}
