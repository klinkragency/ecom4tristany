// admin/app/(dash)/discounts/_forms/shared/AppliesToProductsCollectionsSection.tsx
'use client';

import { Card, MultiPicker } from '@/components/ui';
import type { DiscountPayload } from './types';

export type Product = { id: string; title: string };
export type Collection = { id: string; title: string };

type Scope = 'products' | 'collections';

type Field = 'productIds' | 'buyProductIds' | 'getProductIds';
type CollField = 'collectionIds' | 'buyCollectionIds' | 'getCollectionIds';

export function AppliesToProductsCollectionsSection({
  title = 'Applies to',
  values,
  onChange,
  scope,
  setScope,
  productIdsField,
  collectionIdsField,
  products,
  collections,
}: {
  title?: string;
  values: DiscountPayload;
  onChange: (patch: Partial<DiscountPayload>) => void;
  scope: Scope;
  setScope: (s: Scope) => void;
  productIdsField: Field;
  collectionIdsField: CollField;
  products: Product[];
  collections: Collection[];
}) {
  const productIds = (values as any)[productIdsField] as string[];
  const collectionIds = (values as any)[collectionIdsField] as string[];

  return (
    <Card title={title}>
      <div className="space-y-2 mb-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={scope === 'products'} onChange={() => setScope('products')} />
          Specific products
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" checked={scope === 'collections'} onChange={() => setScope('collections')} />
          Collections
        </label>
      </div>

      {scope === 'products' ? (
        <MultiPicker
          label="Products"
          options={products.map((p) => ({ id: p.id, label: p.title }))}
          selected={productIds}
          onChange={(ids) => onChange({ [productIdsField]: ids } as Partial<DiscountPayload>)}
        />
      ) : (
        <MultiPicker
          label="Collections"
          options={collections.map((c) => ({ id: c.id, label: c.title }))}
          selected={collectionIds}
          onChange={(ids) => onChange({ [collectionIdsField]: ids } as Partial<DiscountPayload>)}
        />
      )}
    </Card>
  );
}
