// admin/app/(dash)/collections/_forms/shared/BasicsSection.tsx
'use client';

import { useRef } from 'react';
import { Card, Field } from '@/components/ui';
import RichTextEditor from '@/components/RichTextEditor';
import type { CollectionPayload } from './types';
import { deriveHandleFromTitle, slugifyHandle } from './helpers';

export function BasicsSection({
  values,
  onChange,
}: {
  values: Pick<CollectionPayload, 'title' | 'handle' | 'descriptionHtml'>;
  onChange: (patch: Partial<CollectionPayload>) => void;
}) {
  // Track whether the user has manually touched the handle. Once they have,
  // we stop auto-deriving it from the title so we don't overwrite their edit.
  const handleTouched = useRef(values.handle.length > 0);

  return (
    <Card title="Basics">
      <div className="space-y-3">
        <Field label="Title" required>
          <input
            className="input"
            value={values.title}
            onChange={(e) => {
              const title = e.target.value;
              const patch: Partial<CollectionPayload> = { title };
              if (!handleTouched.current) {
                patch.handle = deriveHandleFromTitle(title);
              }
              onChange(patch);
            }}
            placeholder="Spring 2026, Best sellers, Sale, …"
          />
        </Field>

        <Field
          label="Handle"
          hint="Used in the storefront URL: /collections/{handle}"
        >
          <input
            className="input font-mono text-sm"
            value={values.handle}
            onChange={(e) => {
              handleTouched.current = true;
              onChange({ handle: slugifyHandle(e.target.value) });
            }}
            placeholder="spring-2026"
          />
        </Field>

        <Field label="Description">
          <RichTextEditor
            value={values.descriptionHtml}
            onChange={(html) => onChange({ descriptionHtml: html })}
            placeholder="Describe what's in this collection…"
            minHeight={140}
          />
        </Field>
      </div>
    </Card>
  );
}
