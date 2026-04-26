// admin/app/(dash)/discounts/_forms/shared/BogoGetSection.tsx
'use client';

import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { AppliesToProductsCollectionsSection, type Product, type Collection } from './AppliesToProductsCollectionsSection';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

export function BogoGetSection({
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
  const scope = values.bogoGetScope ?? 'products';
  return (
    <>
      <Card title="Customer gets">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            <input
              type="number"
              min={1}
              className="input"
              value={values.bogoGetQuantity ?? 1}
              onChange={(e) => onChange({ bogoGetQuantity: Number(e.target.value) })}
            />
          </Field>
          <Field label="Discount on those (%)">
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={values.bogoGetDiscountPercent ?? 100}
              onChange={(e) => onChange({ bogoGetDiscountPercent: Number(e.target.value) })}
            />
          </Field>
        </div>
        {issuesFor(issues, 'bogoGetQuantity').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
        {issuesFor(issues, 'bogoGetDiscountPercent').map((i, idx) => (
          <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
        ))}
      </Card>
      <AppliesToProductsCollectionsSection
        title="Get from"
        values={values}
        onChange={onChange}
        scope={scope}
        setScope={(s) => onChange({ bogoGetScope: s })}
        productIdsField="getProductIds"
        collectionIdsField="getCollectionIds"
        products={products}
        collections={collections}
      />
    </>
  );
}
