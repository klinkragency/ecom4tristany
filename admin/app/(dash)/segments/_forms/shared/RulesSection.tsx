// admin/app/(dash)/segments/_forms/shared/RulesSection.tsx
'use client';

import { Card } from '@/components/ui';
import {
  FIELDS,
  OPS,
  fieldKind,
  needsValue,
  type Field,
  type Operator,
  type Rule,
  type SegmentPayload,
} from './types';

export function RulesSection({
  values,
  onChange,
}: {
  values: Pick<SegmentPayload, 'rules'>;
  onChange: (patch: Partial<SegmentPayload>) => void;
}) {
  function patchRule(idx: number, patch: Partial<Rule>) {
    const next = values.rules.map((r, i) =>
      i === idx ? ({ ...r, ...patch } as Rule) : r,
    );
    onChange({ rules: next });
  }

  function removeRule(idx: number) {
    onChange({
      rules: values.rules
        .filter((_, i) => i !== idx)
        .map((r, i) => ({ ...r, position: i })),
    });
  }

  function addRule() {
    onChange({
      rules: [
        ...values.rules,
        {
          field: 'email',
          operator: 'contains',
          value: '',
          position: values.rules.length,
        },
      ],
    });
  }

  return (
    <Card title="Conditions">
      {values.rules.length === 0 ? (
        <p className="text-sm text-stone-500">
          No conditions yet — without any rules, this segment matches every
          customer.
        </p>
      ) : (
        <ul className="space-y-2">
          {values.rules.map((rule, idx) => {
            const kind = fieldKind(rule.field);
            const ops = OPS[kind] ?? OPS.text;
            // Coerce operator to a valid one for the picked field if the
            // user just changed `field`. Done in render so the next select
            // already shows a sensible default.
            const op = ops.find((o) => o.v === rule.operator)?.v ?? ops[0]!.v;
            return (
              <li
                key={idx}
                className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 text-sm"
              >
                <select
                  className="select w-auto"
                  value={rule.field}
                  onChange={(e) => {
                    const field = e.target.value as Field;
                    const k = fieldKind(field);
                    const list = OPS[k] ?? OPS.text;
                    patchRule(idx, {
                      field,
                      operator: list[0]!.v,
                      // Reset value when switching to a field with different
                      // semantics (e.g. text → number) so we don't carry
                      // garbage into a numeric query.
                      value: '',
                    });
                  }}
                >
                  {FIELDS.map((f) => (
                    <option key={f.v} value={f.v}>
                      {f.l}
                    </option>
                  ))}
                </select>
                <select
                  className="select w-auto"
                  value={op}
                  onChange={(e) =>
                    patchRule(idx, {
                      operator: e.target.value as Operator,
                    })
                  }
                >
                  {ops.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.l}
                    </option>
                  ))}
                </select>
                {needsValue(op) ? (
                  <input
                    className="input text-sm"
                    value={rule.value}
                    onChange={(e) => patchRule(idx, { value: e.target.value })}
                    placeholder={
                      kind === 'number'
                        ? 'e.g. 100'
                        : rule.field === 'country'
                          ? 'e.g. FR'
                          : 'value'
                    }
                  />
                ) : (
                  <div />
                )}
                <button
                  type="button"
                  onClick={() => removeRule(idx)}
                  aria-label="Remove condition"
                  className="rounded px-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        <button type="button" onClick={addRule} className="btn btn-secondary">
          + Add condition
        </button>
      </div>
    </Card>
  );
}
