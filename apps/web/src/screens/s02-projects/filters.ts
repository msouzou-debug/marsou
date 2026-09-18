// S02 — R03, R06
//
// Translates between the screen's structured `ProjectListQuery` and the flat
// `FilterItem[]` the shared `FilterBar` renders as chips (UI instructions §4
// FilterBar). One list item per active filter *value*, not one per facet, so
// removing a single unit or phase chip does not clear the whole facet: each
// item's `key` is `<facet>__<rawValue>` (or the bare "q" for the search box)
// so FilterBar's own remove-by-key logic (`filters.filter(f => f.key !==
// key)`) only ever drops the one chip the user clicked.
//
// FilterBar has no "add a filter" control of its own — only display, remove,
// clear-all and saved views (see its header comment) — so *adding* a value
// happens outside it, in `FacetFilter`, which edits `ProjectListQuery`
// directly. This module is only the FilterBar-facing translation, used for
// display and for the remove/clear/apply-saved-view paths.

import type { FilterItem, SavedView } from "@/components/filter-bar";
import { ProjectListQuery, type ProjectCategory, type ProjectPhase, type Rag } from "@ecapital/shared";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function ragChipKey(rag: Rag): "green" | "amber" | "red" {
  return rag.toLowerCase() as "green" | "amber" | "red";
}

export function queryToFilterItems(
  query: ProjectListQuery,
  unitNameById: Map<string, string>,
  t: Translate,
): FilterItem[] {
  const items: FilterItem[] = [];
  for (const id of query.unit) {
    items.push({ key: `unit__${id}`, label: t("screens.s02.filters.unit"), value: unitNameById.get(id) ?? id });
  }
  for (const phase of query.phase) {
    items.push({ key: `phase__${phase}`, label: t("screens.s02.filters.phase"), value: t(`phases.${phase}`) });
  }
  for (const category of query.category) {
    items.push({
      key: `category__${category}`,
      label: t("screens.s02.filters.category"),
      value: t(`categories.${category}`),
    });
  }
  for (const rag of query.rag) {
    items.push({
      key: `rag__${rag}`,
      label: t("screens.s02.filters.rag"),
      value: t(`components.ragChip.${ragChipKey(rag)}`),
    });
  }
  if (query.q) {
    items.push({ key: "q", label: t("screens.s02.searchLabel"), value: query.q });
  }
  return items;
}

/**
 * Rebuilds the structured query from FilterBar's flat list after a
 * FilterBar-driven change (a chip removed, "clear all", or a saved view
 * applied) — every one of those hands back the *next* full `FilterItem[]`,
 * never a delta.
 *
 * RULE: any filter change resets to page 1 — a stale page number from a
 * longer, unfiltered list would silently show nothing on the new one.
 */
export function filterItemsToQuery(items: FilterItem[], current: ProjectListQuery): ProjectListQuery {
  const unit: string[] = [];
  const phase: ProjectPhase[] = [];
  const category: ProjectCategory[] = [];
  const rag: Rag[] = [];
  let q = "";
  for (const item of items) {
    if (item.key === "q") {
      q = item.value;
      continue;
    }
    const separator = item.key.indexOf("__");
    if (separator < 0) continue;
    const facet = item.key.slice(0, separator);
    const raw = item.key.slice(separator + 2);
    if (facet === "unit") unit.push(raw);
    else if (facet === "phase") phase.push(raw as ProjectPhase);
    else if (facet === "category") category.push(raw as ProjectCategory);
    else if (facet === "rag") rag.push(raw as Rag);
  }
  return ProjectListQuery.parse({ ...current, unit, phase, category, rag, q, page: 1 });
}

// Saved views (UI instructions §4 FilterBar "Αποθηκευμένες προβολές").
// TODO(S27): move to the user profile once it exists; localStorage is a
// placeholder, same pattern as Table's density/column persistence.
const STORAGE_KEY = "ecapital.views.s02";

export function loadSavedViews(): SavedView[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedViews(views: SavedView[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    /* private mode or storage full: the view lasts for this session only */
  }
}
