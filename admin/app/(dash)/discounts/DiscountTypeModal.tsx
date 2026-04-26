'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui';
import { Tag, Gift, Inbox, Truck, ChevronRight } from 'lucide-react';
import type { TypeURL } from './_forms/shared/types';

const TYPES: Array<{
  url: TypeURL;
  title: string;
  description: string;
  Icon: typeof Tag;
}> = [
  { url: 'amount-off-products', title: 'Amount off products', description: 'Discount specific products or collections of products', Icon: Tag },
  { url: 'buy-x-get-y', title: 'Buy X get Y', description: 'Reward customers who buy more', Icon: Gift },
  { url: 'amount-off-order', title: 'Amount off order', description: 'Discount the total order amount', Icon: Inbox },
  { url: 'free-shipping', title: 'Free shipping', description: 'Offer free shipping on an order', Icon: Truck },
];

export function DiscountTypeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <Modal open={open} onClose={onClose} title="Select discount type">
      <ul className="divide-y divide-stone-200">
        {TYPES.map(({ url, title, description, Icon }) => (
          <li key={url}>
            <button
              type="button"
              onClick={() => {
                router.push(`/discounts/new/${url}`);
                onClose();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
            >
              <Icon size={20} className="shrink-0 text-stone-700" />
              <div className="flex-1">
                <div className="font-medium text-sm">{title}</div>
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
