// admin/app/(dash)/discounts/_forms/shared/MethodSection.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, Field } from '@/components/ui';
import type { DiscountPayload } from './types';
import { deriveCode, randomCode } from './helpers';
import { FieldHint } from './FieldHint';
import { issuesFor, type Issue } from './validation';

type Mode = 'code' | 'automatic';

export function MethodSection({
  values,
  onChange,
  issues,
}: {
  values: Pick<DiscountPayload, 'code' | 'title'>;
  onChange: (patch: Partial<DiscountPayload>) => void;
  issues: Issue[];
}) {
  // Mode is derived: empty code = automatic, non-empty = code-mode.
  // We hold a local "mode" too so the user can switch to "code" with an
  // empty input ready for typing without losing autoderive flow.
  const [mode, setMode] = useState<Mode>(values.code ? 'code' : 'code');
  const codeTouched = useRef<boolean>(values.code.length > 0);

  // Auto-derive code from title only if user hasn't manually edited it.
  useEffect(() => {
    if (mode !== 'code') return;
    if (codeTouched.current) return;
    if (!values.title) return;
    onChange({ code: deriveCode(values.title) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.title]);

  function setModeAndClear(m: Mode) {
    setMode(m);
    if (m === 'automatic') {
      onChange({ code: '' });
      codeTouched.current = false;
    }
  }

  return (
    <Card title="Method">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-method"
            checked={mode === 'code'}
            onChange={() => setModeAndClear('code')}
          />
          Discount code
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="discount-method"
            checked={mode === 'automatic'}
            onChange={() => setModeAndClear('automatic')}
          />
          Automatic discount
        </label>
      </div>

      <Field label="Title (admin-facing)" required className="mt-4">
        <input
          className="input"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Spring sale 2026"
        />
      </Field>
      {issuesFor(issues, 'title').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}

      {mode === 'code' ? (
        <Field label="Code (customers type this at checkout)" className="mt-3">
          <div className="flex gap-2">
            <input
              className="input font-mono uppercase flex-1"
              value={values.code}
              onChange={(e) => {
                codeTouched.current = true;
                onChange({ code: e.target.value.toUpperCase() });
              }}
              placeholder="SUMMER20"
            />
            <button
              type="button"
              onClick={() => {
                codeTouched.current = true;
                onChange({ code: randomCode() });
              }}
              className="btn"
              title="Generate a random code"
            >
              🎲
            </button>
          </div>
        </Field>
      ) : (
        <div className="mt-3 rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">
          ✨ No code required — this discount applies automatically when conditions are met.
        </div>
      )}
      {issuesFor(issues, 'code').map((i, idx) => (
        <FieldHint key={idx} variant={i.variant}>{i.message}</FieldHint>
      ))}
    </Card>
  );
}
