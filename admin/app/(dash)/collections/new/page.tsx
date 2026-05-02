import { redirect } from 'next/navigation';

export default function NewCollectionIndex() {
  redirect('/collections?new=1');
}
