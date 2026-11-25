// S07e — R08
//
// Between the register's `ContractsFilter` and the flat `FilterItem[]` the
// shared `FilterBar` shows as chips, the way S02's `filters.ts` does it: one
// chip per unit (`unit__<id>`) and one for the project (`project__<id>`), so
// removing one chip drops that value and nothing else, and the raw id rides
// in the key while the chip shows the name.

import type { FilterItem, SavedView } from "@/components/filter-bar";
import type { ContractsFilter } from "./query";

type Translate = (key: string) => string;

export interface ProjectOption {
  id: string;
  code: string;
  titleEl: string;
  orgUnitId: string;
}

export function projectLabel(project: ProjectOption): string {
  return `${project.code} — ${project.titleEl}`;
}

export function filterToItems(
  filter: ContractsFilter,
  unitNameById: Map<string, string>,
  projectById: Map<string, ProjectOption>,
  t: Translate,
): FilterItem[] {
  const items: FilterItem[] = filter.unit.map((id) => ({
    key: `unit__${id}`,
    label: t("screens.s07e.filters.unit"),
    value: unitNameById.get(id) ?? id,
  }));
  if (filter.project) {
    const project = projectById.get(filter.project);
    items.push({
      key: `project__${filter.project}`,
      label: t("screens.s07e.filters.project"),
      value: project ? projectLabel(project) : filter.project,
    });
  }
  return items;
}

/** FilterBar hands back the whole next list (a chip removed, clear-all, a saved view). */
export function itemsToFilter(items: FilterItem[]): ContractsFilter {
  const unit: string[] = [];
  let project = "";
  for (const item of items) {
    const separator = item.key.indexOf("__");
    if (separator < 0) continue;
    const facet = item.key.slice(0, separator);
    const raw = item.key.slice(separator + 2);
    if (facet === "unit") unit.push(raw);
    else if (facet === "project") project = raw;
  }
  return { unit, project };
}

// Saved views, in localStorage like S02's, under this screen's own key.
const STORAGE_KEY = "ecapital.views.s07e";

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
