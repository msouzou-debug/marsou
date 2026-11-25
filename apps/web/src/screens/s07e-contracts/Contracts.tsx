"use client";

// S07e — R08
//
/**
 * Contracts — the contract register across every project the caller may see.
 *
 * It exists because of ADR-0019: eFinance points an invoice's `contract_ref`
 * at `/contracts?q=<ref>`, and a clerk who lands there without a reference,
 * or with one that matches nothing, needs somewhere to be. The same screen
 * then doubles as the register a head of estates can search.
 *
 * | Prop         | Type                   | Notes                                                      |
 * |--------------|------------------------|-------------------------------------------------------------|
 * | items        | Contract[]             | Ignored in `noPermission` \| `loading` \| `error`.            |
 * | state        | ContractsScreenState   | Which of the five states to draw.                            |
 * | q            | string?                | The search term, echoed into the field.                      |
 * | onSearch     | (q: string) => void    | Pushes the term into the URL; the screen refetches.          |
 * | onRetry      | () => void?            | Wired to the error state's retry button.                     |
 * | noPermission | ReactNode              | The shell's `NoPermission`.                                  |
 * | orgUnits     | OrgUnit[]?             | The caller's visible units — the «Μονάδα» filter's options.  |
 * | filter       | ContractsFilter?       | The «Μονάδα» and «Έργο» filters, from the URL.               |
 * | projects     | ProjectOption[]?       | The «Έργο» options: the projects of the units chosen, or of every visible unit when none is. |
 * | onFilterChange | (filter) => void?    | Pushes the filters into the URL; the screen refetches.       |
 *
 * «Μονάδα» is a multi-select (S02's `FacetFilter`), «Έργο» a single select
 * narrowed by it; both show as chips in the shared `FilterBar`, which can
 * remove one, clear them all or save the combination as a view.
 * RULE: choosing units drops a chosen project that is in none of them — a
 * project filter the unit filter contradicts would only ever say «nothing».
 *
 * A list and not a `Table`: the register is read one row at a time, on a
 * phone as often as on a desktop, and the export button CONVENTIONS.md asks
 * of every table belongs to the screens that are meant to be exported (S02's
 * project register). This one is a way through to a contract.
 *
 * ADR-0025: the budget code is an optional, hidden-by-default line on each
 * row, switched on with the checkbox above the list — this screen's own
 * equivalent of `Table`'s hidden-by-default column, since it is a list of
 * cards and not a table with columns to choose from. Off by default, and not
 * persisted across visits: showing it is a rare need (checking that a batch
 * of contracts all carry the code they should), not the ordinary way this
 * register is read.
 */
import type { ReactNode } from "react";
import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { Contract, OrgUnit } from "@ecapital/shared";
import { EmptyState } from "@/components/empty-state";
import { PageTitle } from "@/components/app-shell";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { formatDate, formatEUR } from "@/lib/format";
import { FacetFilter } from "@/screens/s02-projects/FacetFilter";
import {
  type ProjectOption,
  filterToItems,
  itemsToFilter,
  loadSavedViews,
  projectLabel,
  saveSavedViews,
} from "./filters";
import { type ContractsFilter, NO_FILTER, isFiltered } from "./query";

export type ContractsScreenState = "default" | "loading" | "empty" | "error" | "noPermission";

export interface ContractsProps {
  items?: Contract[];
  state: ContractsScreenState;
  q?: string;
  onSearch?: (q: string) => void;
  onRetry?: () => void;
  noPermission: ReactNode;
  orgUnits?: OrgUnit[];
  filter?: ContractsFilter;
  projects?: ProjectOption[];
  onFilterChange?: (filter: ContractsFilter) => void;
}

export function Contracts({
  items = [],
  state,
  q = "",
  onSearch = () => undefined,
  onRetry,
  noPermission,
  orgUnits = [],
  filter = NO_FILTER,
  projects = [],
  onFilterChange = () => undefined,
}: ContractsProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [term, setTerm] = useState(q);
  // ADR-0025: off by default, per-visit only — see the header comment.
  const [showBudgetCode, setShowBudgetCode] = useState(false);
  // Read once on the client, as S02 does; the server pass gets none.
  const [savedViews, setSavedViews] = useState<ReturnType<typeof loadSavedViews>>(() =>
    typeof window === "undefined" ? [] : loadSavedViews(),
  );

  const unitNameById = useMemo(
    () => new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const)),
    [orgUnits, locale],
  );
  const unitOptions = useMemo(
    () =>
      orgUnits
        .map((u) => ({ value: u.id, label: unitNameById.get(u.id) ?? u.id }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [orgUnits, unitNameById, locale],
  );
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p] as const)), [projects]);
  const filterItems = useMemo(
    () => filterToItems(filter, unitNameById, projectById, t),
    [filter, unitNameById, projectById, t],
  );

  if (state === "noPermission") return <>{noPermission}</>;

  function toggleUnit(id: string) {
    const unit = filter.unit.includes(id) ? filter.unit.filter((u) => u !== id) : [...filter.unit, id];
    // RULE (header): a chosen project outside every chosen unit goes.
    const chosen = projectById.get(filter.project);
    const keepProject = !filter.project || unit.length === 0 || (chosen !== undefined && unit.includes(chosen.orgUnitId));
    onFilterChange({ unit, project: keepProject ? filter.project : "" });
  }

  function handleFilterBarChange(next: FilterItem[]) {
    onFilterChange(itemsToFilter(next));
  }

  function handleSaveView(name: string) {
    const next = [...savedViews, { id: `view-${Date.now()}`, label: name, filters: filterItems }];
    setSavedViews(next);
    saveSavedViews(next);
  }

  const filtered = isFiltered(filter);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(term.trim());
  }

  return (
    <>
      <PageTitle eyebrow={t("screens.s07e.eyebrow")} title={t("screens.s07e.title")} />

      <form onSubmit={submit} className="mb-s-6 flex flex-wrap items-end gap-s-3">
        <div className="flex min-w-[260px] flex-1 flex-col gap-s-2">
          <label htmlFor="contracts-q" className="text-fs-14 text-k-text">
            {t("screens.s07e.searchLabel")}
          </label>
          <input
            id="contracts-q"
            name="q"
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("screens.s07e.searchPlaceholder")}
            className="h-11 rounded-k border border-k-grey bg-k-white px-s-3 text-fs-16 text-k-text"
          />
        </div>
        <button
          type="submit"
          className="flex h-11 items-center gap-s-2 rounded-k border border-k-grey px-s-4 text-fs-14 font-bold text-k-blue-deep"
        >
          <Search size={20} strokeWidth={1.5} aria-hidden="true" />
          <span>{t("common.search")}</span>
        </button>
      </form>

      <div className="mb-s-6 flex flex-col gap-s-3" data-testid="contract-filters">
        <div className="flex flex-wrap items-end gap-s-3">
          <FacetFilter
            label={t("screens.s07e.filters.unit")}
            options={unitOptions}
            selected={filter.unit}
            onToggle={toggleUnit}
          />
          <label className="flex min-w-[240px] flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s07e.filters.project")}
            <select
              value={filter.project}
              onChange={(event) => onFilterChange({ ...filter, project: event.target.value })}
              className="h-11 max-w-[420px] rounded-k border border-k-grey bg-k-white px-s-3 text-fs-14 text-k-ink"
            >
              <option value="">{t("screens.s07e.filters.allProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {projectLabel(project)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <FilterBar
          filters={filterItems}
          onChange={handleFilterBarChange}
          savedViews={savedViews}
          onSaveView={handleSaveView}
        />
      </div>

      {state === "loading" && (
        <ul aria-hidden="true" aria-busy="true" className="grid gap-s-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-[64px] animate-pulse rounded-k bg-k-grey" />
          ))}
        </ul>
      )}

      {state === "error" && (
        <div className="rounded-k border border-k-grey bg-k-white p-s-8 text-center">
          <p className="text-fs-16 text-k-ink">{t("states.error.loadFailed")}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-s-4 rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14 text-k-blue-deep"
            >
              {t("common.retry")}
            </button>
          )}
        </div>
      )}

      {state === "empty" && (
        filtered && !q ? (
          <EmptyState
            message={t("screens.s07e.emptyFiltered")}
            actionLabel={t("screens.s07e.clearFilters")}
            onAction={() => onFilterChange(NO_FILTER)}
          />
        ) : (
          <EmptyState
            message={q ? t("screens.s07e.emptySearch", { q }) : t("screens.s07e.empty")}
            actionLabel={t("screens.s07e.clearSearch")}
            onAction={() => {
              setTerm("");
              onSearch("");
            }}
          />
        )
      )}

      {state === "default" && (
        <>
          {/* ADR-0025: hidden-by-default, this list's own equivalent of a
              `Table` column the person switches on themselves. */}
          <label className="mb-s-3 flex h-11 w-fit items-center gap-s-2 text-fs-14 text-k-text">
            <input
              type="checkbox"
              checked={showBudgetCode}
              onChange={(event) => setShowBudgetCode(event.target.checked)}
              className="h-4 w-4"
            />
            <span>{t("screens.s07e.showBudgetCode")}</span>
          </label>

          <ul className="grid gap-s-2" data-testid="contract-list">
            {items.map((contract) => (
              <li
                key={contract.id}
                className="flex flex-wrap items-baseline justify-between gap-s-3 rounded-k border border-k-grey bg-k-white px-s-4 py-s-3"
              >
                <div>
                  {/* RULE (ADR-0019): the eCapital reference is what eFinance
                      stores against an invoice, so it is the first thing on the
                      row and it is mono — it is read character by character. */}
                  <span className="num text-fs-12 text-k-text">{contract.ref}</span>
                  <Link
                    href={`/contracts/${encodeURIComponent(contract.id)}`}
                    className="block text-fs-16 font-bold text-k-blue-deep underline-offset-2 hover:underline"
                  >
                    {contract.contractorName}
                  </Link>
                  <p className="text-fs-14 text-k-text">
                    {contract.contractNo} · {formatDate(contract.awardDate)}
                  </p>
                  {showBudgetCode && (
                    <p className="num text-fs-14 text-k-text">
                      {t("screens.s07e.budgetCodeLabel")}: {contract.budgetCode ?? t("common.notAvailable")}
                    </p>
                  )}
                </div>
                <span className="num text-fs-16 text-k-ink">{formatEUR(contract.currentValue)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
