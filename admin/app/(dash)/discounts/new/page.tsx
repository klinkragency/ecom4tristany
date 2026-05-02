import { redirect } from 'next/navigation';

export default function NewDiscountIndex() {
  redirect('/discounts?new=1');
}
