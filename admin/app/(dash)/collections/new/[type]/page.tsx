import { notFound } from 'next/navigation';
import { isCollectionTypeURL, initialForType } from '../../_forms/shared/types';
import ManualCollectionForm from '../../_forms/ManualCollectionForm';
import SmartCollectionForm from '../../_forms/SmartCollectionForm';

export default async function NewCollectionPage({
  params,
}: {
  params: Promise<{ type: string }>;
}) {
  const { type } = await params;
  if (!isCollectionTypeURL(type)) notFound();
  const initial = initialForType(type);
  switch (type) {
    case 'manual':
      return <ManualCollectionForm initial={initial} mode="create" />;
    case 'smart':
      return <SmartCollectionForm initial={initial} mode="create" />;
  }
}
