"use client";

// S02 — R03, R06
//
// A small multi-select checklist dropdown, in the same visual language as
// Table's own column chooser (UI instructions §4). FilterBar has no "add a
// filter" control of its own — it only displays, removes and saves already-
// active chips (see its header comment) — so the four S02 facets (Μονάδα,
// Φάση, Κατηγορία, RAG) get this instead; see `filters.ts` for how a
// selection here becomes a FilterBar chip.
//
// | Prop     | Type                  | Notes                                    |
// |----------|-----------------------|--------------------------------------------|
// | label    | string                | The facet name shown on the trigger.        |
// | options  | FacetOption<V>[]      | Every value in the facet, in display order. |
// | selected | V[]                   | Currently active values.                    |
// | onToggle | (value: V) => void    | Fired when a checkbox is (un)checked.       |

export interface FacetOption<V extends string> {
  value: V;
  label: string;
}

export interface FacetFilterProps<V extends string> {
  label: string;
  options: FacetOption<V>[];
  selected: V[];
  onToggle: (value: V) => void;
}

export function FacetFilter<V extends string>({ label, options, selected, onToggle }: FacetFilterProps<V>) {
  return (
    <details className="relative">
      <summary className="flex cursor-pointer list-none items-center gap-s-2 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-text">
        {label}
        {selected.length > 0 && (
          <span className="num rounded-k-chip bg-k-blue-bg px-s-1 text-fs-12 text-k-blue-deep">
            {selected.length}
          </span>
        )}
      </summary>
      <div className="absolute z-20 mt-s-1 w-max max-w-[280px] rounded-k border border-k-grey bg-k-white p-s-3 shadow-k">
        <ul className="grid gap-s-2">
          {options.map((option) => (
            <li key={option.value}>
              <label className="flex items-center gap-s-2 text-fs-14">
                <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} />
                {option.label}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
