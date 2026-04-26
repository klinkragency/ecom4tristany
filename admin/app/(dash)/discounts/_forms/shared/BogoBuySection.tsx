// admin/app/(dash)/discounts/_forms/shared/BogoBuySection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { AppliesToProductsCollectionsSection, type Product, type Collection } from './AppliesToProductsCollectionsSection';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function BogoBuySection({
  values,
  onChange,
  products,
  collections,
  issues,
}: {
  values: DiscountPayload;
  onChange: (patch: Partial<DiscountPayload>) => void;
  products: Product[];
  collections: Collection[];
  issues: Issue[];
}) {
  const scope = values.bogoBuyScope ?? 'products';
  return (
    <>
      <Card title="Customer buys">
        <Field label="Quantity">
          <input
            type="number"
            min={1}
            className="input w-32"
            value={values.bogoBuyQuantity ?? 1}
            onChange={(e) => onChange({ bogoBuyQuantity: Number(e.target.value) })}
          />
        </Field>
        {issuesFor(issues, 'bogoBuyQuantity').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
      </Card>
      <AppliesToProductsCollectionsSection
        title="Buy from"
        values={values}
        onChange={onChange}
        scope={scope}
        setScope={(s) => onChange({ bogoBuyScope: s })}
        productIdsField="buyProductIds"
        collectionIdsField="buyCollectionIds"
        products={products}
        collections={collections}
      />
    </>
  );
}
