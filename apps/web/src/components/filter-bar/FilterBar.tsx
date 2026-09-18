"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";

export interface FilterItem {
  key: string;
  label: string;
  value: string;
}

export interface SavedView {
  id: string;
  label: string;
  filters: FilterItem[];
}

/**
 * FilterBar — active-filter chips, saved views, save/clear
 * (UI instructions §4 FilterBar, used by S02 and similar list screens).
 *
 * | Prop       | Type              | Notes                                              |
 * |------------|-------------------|-------------------------------------------------------|
 * | filters    | FilterItem[]      | Active filters, each removable                          |
 * | onChange   | (FilterItem[]) => void | Fired with the new filter list                     |
 * | savedViews | SavedView[]       | Listed in the "Αποθηκευμένες προβολές" dropdown          |
 * | onSaveView | (name: string) => void | Fired with a name when the user saves the view    |
 *
 * RULE: filter changes update the URL query string, so a filtered list is
 * shareable and survives a refresh. Only the keys this bar manages
 * (`filters[].key`) are touched; every other query param is left as-is.
 *
 * State: default, empty (no active filters — the chip row is empty but the
 * saved-views dropdown and save/clear controls still render).
 */
export interface FilterBarProps {
  filters: FilterItem[];
  onChange: (filters: FilterItem[]) => void;
  savedViews: SavedView[];
  onSaveView: (name: string) => void;
}

export function FilterBar({ filters, onChange, savedViews, onSaveView }: FilterBarProps) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [savingViewName, setSavingViewName] = useState<string | null>(null);

  function syncUrl(next: FilterItem[]) {
    const params = new URLSearchParams(searchParams.toString());
    for (const f of filters) params.delete(f.key);
    for (const f of next) params.set(f.key, f.value);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function apply(next: FilterItem[]) {
    syncUrl(next);
    onChange(next);
  }

  function removeFilter(key: string) {
    apply(filters.filter((f) => f.key !== key));
  }

  function clearAll() {
    apply([]);
  }

  function applySavedView(view: SavedView) {
    apply(view.filters);
  }

  function confirmSaveView() {
    if (!savingViewName?.trim()) return;
    onSaveView(savingViewName.trim());
    setSavingViewName(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-s-3">
      <div className="flex flex-wrap items-center gap-s-2">
        {filters.map((f) => (
          <span
            key={f.key}
            className="flex items-center gap-s-1 rounded-k-chip bg-k-blue-bg px-s-3 py-s-1 text-fs-14 text-k-blue-deep"
          >
            {f.label}: {f.value}
            <button
              type="button"
              onClick={() => removeFilter(f.key)}
              aria-label={t("components.filter-bar.removeFilter", { label: f.label })}
              className="ml-s-1 rounded-full p-[2px] hover:bg-k-white"
            >
              <X size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>

      {filters.length > 0 && (
        <button type="button" onClick={clearAll} className="text-fs-14 text-k-blue">
          {t("components.filter-bar.clearAll")}
        </button>
      )}

      <div className="ml-auto flex items-center gap-s-3">
        <label className="text-fs-14 text-k-text">
          {t("components.filter-bar.savedViews")}
          <select
            className="ml-s-2 rounded-k border border-k-grey p-s-2 text-fs-14"
            value=""
            onChange={(e) => {
              const view = savedViews.find((v) => v.id === e.target.value);
              if (view) applySavedView(view);
            }}
          >
            <option value="" disabled>
              {savedViews.length === 0 ? t("components.filter-bar.noSavedViews") : t("components.filter-bar.selectView")}
            </option>
            {savedViews.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>

        {savingViewName === null ? (
          <button type="button" onClick={() => setSavingViewName("")} className="text-fs-14 text-k-blue">
            {t("components.filter-bar.saveView")}
          </button>
        ) : (
          <span className="flex items-center gap-s-2">
            <input
              type="text"
              autoFocus
              value={savingViewName}
              onChange={(e) => setSavingViewName(e.target.value)}
              placeholder={t("components.filter-bar.viewNamePlaceholder")}
              className="rounded-k border border-k-grey p-s-2 text-fs-14"
            />
            <button
              type="button"
              onClick={confirmSaveView}
              disabled={!savingViewName.trim()}
              className="rounded-k bg-k-blue px-s-3 py-s-2 text-fs-14 font-bold text-k-white disabled:bg-k-grey disabled:text-k-text-muted"
            >
              {t("buttons.save")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
