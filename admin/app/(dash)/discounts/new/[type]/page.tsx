import { notFound } from 'next/navigation';
import { isTypeURL, initialForType } from '../../_forms/shared/types';
import AmountOffOrderForm from '../../_forms/AmountOffOrderForm';
import AmountOffProductsForm from '../../_forms/AmountOffProductsForm';
import BuyXGetYForm from '../../_forms/BuyXGetYForm';
import FreeShippingForm from '../../_forms/FreeShippingForm';

export default async function NewDiscountPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isTypeURL(type)) notFound();
  const initial = initialForType(type);
  switch (type) {
    case 'amount-off-order':    return <AmountOffOrderForm initial={initial} mode="create" />;
    case 'amount-off-products': return <AmountOffProductsForm initial={initial} mode="create" />;
    case 'buy-x-get-y':         return <BuyXGetYForm initial={initial} mode="create" />;
    case 'free-shipping':       return <FreeShippingForm initial={initial} mode="create" />;
  }
}
