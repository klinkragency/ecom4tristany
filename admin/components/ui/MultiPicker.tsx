// A scrollable checkbox list, used across discounts/segments/forms to pick
// a subset of products / collections / segments / etc.
export function MultiPicker({
  label,
  options,
  selected,
  onChange,
  emptyLabel = 'None available.',
  maxHeight = 176,
}: {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  emptyLabel?: string;
  maxHeight?: number;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else onChange([...selected, id]);
  };
  return (
    <div className="mt-2">
      <div className="label">{label}</div>
      {options.length === 0 ? (
        <p className="text-xs text-stone-500">{emptyLabel}</p>
      ) : (
        <ul
          className="divide-y divide-stone-200/70 overflow-y-auto rounded-xl border border-stone-200 bg-white text-sm"
          style={{ maxHeight }}
        >
          {options.map((o) => (
            <li key={o.id}>
              <label className="flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-stone-50">
                <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
                <span>{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
