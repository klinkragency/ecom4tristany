'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui';
import { Hand, Sparkles, ChevronRight } from 'lucide-react';
import type { CollectionTypeURL } from './_forms/shared/types';

const TYPES: Array<{
  url: CollectionTypeURL;
  title: string;
  description: string;
  Icon: typeof Hand;
}> = [
  {
    url: 'manual',
    title: 'Manual collection',
    description: 'Pick products one by one and arrange them in the order you want',
    Icon: Hand,
  },
  {
    url: 'smart',
    title: 'Smart collection',
    description: 'Auto-match products by rules — the catalog populates it for you',
    Icon: Sparkles,
  },
];

export function CollectionTypeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title="Select collection type">
      <ul className="divide-y divide-stone-200">
        {TYPES.map(({ url, title, description, Icon }) => (
          <li key={url}>
            <button
              type="button"
              onClick={() => {
                router.push(`/collections/new/${url}`);
                onClose();
              }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
            >
              <Icon size={20} className="shrink-0 text-stone-700" />
              <div className="flex-1">
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-stone-500">{description}</div>
              </div>
              <ChevronRight size={16} className="shrink-0 text-stone-400" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
