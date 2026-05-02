'use client';

import { use, useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import { api } from '@/lib/api';
import SegmentForm from '../_forms/SegmentForm';
import {
  normalizeSegment,
  type SegmentPayload,
  type SegmentResponse,
} from '../_forms/shared/types';

export default function EditSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [segment, setSegment] = useState<SegmentPayload | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const s = await api<SegmentResponse>(`/api/admin/segments/${id}`);
        setSegment(normalizeSegment(s));
      } catch {
        setMissing(true);
      }
    })();
  }, [id]);

  if (missing) notFound();
  if (!segment) return <div className="p-6 text-stone-500">Loading…</div>;

  return <SegmentForm initial={segment} mode="edit" id={id} />;
}
