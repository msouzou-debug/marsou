"use client";

// S02 — R03, R06, R07
//
/**
 * Projects — the pure S02 screen body (UI instructions §5 "S02 is a Table +
 * FilterBar", §6 states).
 *
 * Takes data the caller already fetched (`ProjectsScreen` is the only place
 * that calls `useProjects`, same split as S01's Portfolio/PortfolioScreen —
 * see that pair's header comments) and the current, already-parsed
 * `ProjectListQuery` (from the URL — `ProjectsScreen` parses it once via
 * `parseProjectsQuery`). This component owns every further change to that
 * query — facet toggles, search, sort clicks, pagination, FilterBar's own
 * remove/clear/saved-view actions — by pushing a new URL with `router`
 * itself, the same way S01's `UnitTable` and `FilterBar` itself call
 * `useRouter()` directly rather than being handed a callback prop.
 *
 * | Prop         | Type                 | Notes                                                        |
 * |--------------|----------------------|-----------------------------------------------------------------|
 * | data         | ProjectList?         | Ignored in `noPermission`; required otherwise.                   |
 * | state        | ProjectsScreenState  | Which of the five states (plus "default") to render.             |
 * | query        | ProjectListQuery     | The current, defaulted query — the single source of truth for every filter/sort/page control. |
 * | orgUnits     | OrgUnit[]            | The caller's own visible units (R01) — feeds the Μονάδα filter and the table's unit column. |
 * | eyebrow      | string               | Resolved by the caller: the one visible unit's name, or «Όλες οι μονάδες». |
 * | onRetry      | () => void?          | Wired to the error state's retry button.                        |
 * | noPermission | ReactNode            | The shell's `NoPermission`, rendered as-is (see S01's `Portfolio` for why an element, not a component, crosses this boundary). |
 * | roles        | AppRole[]            | `me.roles`. RULE (`@/auth/roles`): «Προσθήκη» is a live link to S02a for anyone who may write a project, and a disabled button with a tooltip (ADR-0010's read-only roles) otherwise — never disabled with no reason given. |
 */

import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  ProjectCategory,
  ProjectListQuery,
  ProjectPhase,
  Rag,
  type AppRole,
  type OrgUnit,
  type ProjectList,
  type ProjectSort,
  type ProjectSummary,
} from "@ecapital/shared";
import { canWriteProjects } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { RagChip } from "@/components/rag-chip";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDate, formatEUR } from "@/lib/format";
import { FacetFilter } from "./FacetFilter";
import { filterItemsToQuery, loadSavedViews, queryToFilterItems, ragChipKey, saveSavedViews } from "./filters";
import { ProjectCards } from "./ProjectCards";
import { projectsQueryToSearchParams } from "./query";

export type ProjectsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ProjectsProps {
  data?: ProjectList;
  state: ProjectsScreenState;
  query: ProjectListQuery;
  orgUnits: OrgUnit[];
  eyebrow: string;
  onRetry?: () => void;
  noPermission: ReactNode;
  /** Defaults to `[]` — no write role — so an existing caller with no
   *  reason to care about «Προσθήκη» (most of this screen's own tests)
   *  does not have to pass one. */
  roles?: AppRole[];
}

// Table headers wired to a sortable ProjectSort field, by column id.
// Category, commitments and spend have no ProjectSort entry in the contract,
// so they render sort-disabled headers (Table's own `sortable: false`).
const SORT_BY_COLUMN_ID: Partial<Record<string, ProjectSort>> = {
  code: "code",
  title: "titleEl",
  unit: "orgUnit",
  phase: "phase",
  approvedBudget: "approvedBudget",
  plannedFinish: "plannedFinish",
  rag: "rag",
};

export function Projects({ data, state, query, orgUnits, eyebrow, onRetry, noPermission, roles = [] }: ProjectsProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  // RULE (rules of hooks): every hook below must run on every render — the
  // `noPermission` early return happens once, right before the final JSX,
  // never before a hook (S01's `Portfolio` gets away with the check this
  // early only because it has no hooks after `useTranslations`; this screen
  // has many, so the check moves to the bottom instead).
  const unitNameById = useMemo(
    () => new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const)),
    [orgUnits, locale],
  );

  function navigate(next: ProjectListQuery) {
    const qs = projectsQueryToSearchParams(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // RULE: every filter, sort and search change resets to page 1 — a stale
  // page number from a longer result set would otherwise silently show
  // nothing on a shorter, newly-filtered one.
  function toggleFacet(facet: "unit" | "phase" | "category" | "rag", value: string) {
    const current = query[facet] as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    navigate({ ...query, [facet]: next, page: 1 } as ProjectListQuery);
  }

  // The search box updates the URL on every change (UI instructions §4
  // FilterBar), debounced so each keystroke does not refetch on its own.
  // `searchDraft` resyncs to `query.q` when it changes from outside this
  // input (a chip removed, "clear filters") via the "adjusting state when a
  // prop changes" pattern — a state update during render, not an effect
  // (react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [searchDraft, setSearchDraft] = useState(query.q);
  const [syncedQ, setSyncedQ] = useState(query.q);
  if (query.q !== syncedQ) {
    setSyncedQ(query.q);
    setSearchDraft(query.q);
  }
  useEffect(() => {
    if (searchDraft === query.q) return;
    const timeout = setTimeout(() => {
      const qs = projectsQueryToSearchParams({ ...query, q: searchDraft, page: 1 }).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    }, 400);
    return () => clearTimeout(timeout);
  }, [searchDraft, query, pathname, router]);

  // Saved views live in localStorage (`filters.ts`), a browser-only API. The
  // lazy initializer reads it once on the client; the server-rendered pass
  // (where `window` does not exist) gets the safe empty default — the same
  // read-once-in-a-lazy-initializer shape S01's `useOnlineStatus` uses for
  // `navigator.onLine`, rather than an effect just to mirror a read into state.
  const [savedViews, setSavedViews] = useState<ReturnType<typeof loadSavedViews>>(() =>
    typeof window === "undefined" ? [] : loadSavedViews(),
  );

  const filterItems = useMemo(() => queryToFilterItems(query, unitNameById, t), [query, unitNameById, t]);

  function handleFilterBarChange(next: FilterItem[]) {
    navigate(filterItemsToQuery(next, query));
  }

  function handleSaveView(name: string) {
    const next = [...savedViews, { id: `view-${Date.now()}`, label: name, filters: filterItems }];
    setSavedViews(next);
    saveSavedViews(next);
  }

  function clearFilters() {
    navigate(ProjectListQuery.parse({}));
  }

  const unitOptions = useMemo(
    () =>
      orgUnits
        .map((u) => ({ value: u.id, label: unitNameById.get(u.id) ?? u.id }))
        .sort((a, b) => a.label.localeCompare(b.label, locale)),
    [orgUnits, unitNameById, locale],
  );
  const phaseOptions = useMemo(() => ProjectPhase.options.map((p) => ({ value: p, label: t(`phases.${p}`) })), [t]);
  const categoryOptions = useMemo(
    () => ProjectCategory.options.map((c) => ({ value: c, label: t(`categories.${c}`) })),
    [t],
  );
  const ragOptions = useMemo(
    () => Rag.options.map((r) => ({ value: r, label: t(`components.ragChip.${ragChipKey(r)}`) })),
    [t],
  );

  const columns = useMemo<Array<TableColumn<ProjectSummary>>>(
    () => [
      {
        id: "code",
        headerKey: "screens.s02.columns.code",
        accessor: (row) => row.code,
        cell: (row) => <span className="font-k-mono">{row.code}</span>,
      },
      {
        // RULE: second column, right after Κωδικός, so RAG is visible at
        // 1440 without having to scroll the table (moved from last).
        id: "rag",
        headerKey: "common.rag",
        accessor: (row) => row.rag,
        cell: (row) => <RagChip value={ragChipKey(row.rag)} />,
      },
      {
        id: "title",
        headerKey: "screens.s02.columns.project",
        accessor: (row) => row.titleEl,
        cell: (row) => (
          <Link href={`/projects/${encodeURIComponent(row.id)}`} className="text-k-blue underline-offset-2 hover:underline">
            {row.titleEl}
          </Link>
        ),
      },
      {
        id: "unit",
        headerKey: "common.unit",
        accessor: (row) => unitNameById.get(row.orgUnitId) ?? row.orgUnitId,
      },
      {
        id: "phase",
        headerKey: "common.phase",
        accessor: (row) => t(`phases.${row.phase}`),
      },
      {
        id: "category",
        headerKey: "common.category",
        accessor: (row) => t(`categories.${row.category}`),
        sortable: false,
      },
      {
        id: "approvedBudget",
        headerKey: "components.costBar.approved",
        accessor: (row) => row.approvedBudget,
        cell: (row) => formatEUR(row.approvedBudget),
        numeric: true,
      },
      {
        id: "committed",
        headerKey: "components.costBar.committed",
        accessor: (row) => row.ledgers.committed,
        // RULE (contract `ProjectLedgers`): null until the SAP import — «—», never «0 €».
        cell: (row) => (row.ledgers.committed === null ? t("common.notAvailable") : formatEUR(row.ledgers.committed)),
        numeric: true,
        sortable: false,
      },
      {
        id: "spent",
        headerKey: "components.costBar.spent",
        accessor: (row) => row.ledgers.spent,
        cell: (row) => (row.ledgers.spent === null ? t("common.notAvailable") : formatEUR(row.ledgers.spent)),
        numeric: true,
        sortable: false,
      },
      {
        id: "plannedFinish",
        headerKey: "screens.s02.columns.plannedFinish",
        accessor: (row) => row.plannedFinish ?? "",
        cell: (row) => (row.plannedFinish ? formatDate(row.plannedFinish) : t("common.notAvailable")),
        numeric: true,
      },
    ],
    [t, unitNameById],
  );

  // RULE: `Table` sorts only the rows it already has, client-side, and has
  // no controlled-sort prop (see its own header comment) — the mock handler
  // already returns rows sorted server-side by `query.sort`/`dir`, so a
  // header click here both lets Table's own toggle run (for the chevron)
  // and pushes the URL, the same DOM-delegation workaround S01's `UnitTable`
  // uses for its row click, for the same reason: a gap in a shared
  // component this screen may not change.
  function handleHeaderClick(event: MouseEvent<HTMLDivElement>) {
    const th = (event.target as HTMLElement).closest("th");
    if (!th || !th.hasAttribute("aria-sort")) return;
    const row = th.parentElement;
    if (!row) return;
    const columnIndex = Array.from(row.children).indexOf(th);
    const column = columns[columnIndex];
    const sortKey = column && SORT_BY_COLUMN_ID[column.id];
    if (!sortKey) return;
    const nextDir = query.sort === sortKey && query.dir === "asc" ? "desc" : "asc";
    navigate({ ...query, sort: sortKey, dir: nextDir, page: 1 });
  }

  // TODO(R39): live-formula Excel export.
  const handleExport = () => undefined;

  const tableState: TableState = state === "default" ? "default" : state;
  const showCards = (state === "default" || state === "offline") && !!data;

  const total = data?.total ?? 0;
  const page = query.page;
  const pageSize = query.pageSize;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  if (state === "noPermission") return <>{noPermission}</>;

  // RULE (`@/auth/roles`): a live link for anyone who may open S02a, a
  // disabled button naming the reason for anyone who cannot — never
  // disabled with nothing said, offline included (there is nowhere for an
  // offline create to queue to; UI instructions §6 "disabled with the
  // reason in the button tooltip").
  const canCreate = state !== "offline" && canWriteProjects(roles);

  return (
    <>
      <PageTitle
        eyebrow={eyebrow}
        title={t("screens.s02.title")}
        action={
          canCreate ? (
            <Link
              href="/projects/new"
              className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white shadow-k"
            >
              {t("buttons.add")}
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title={state === "offline" ? t("states.offline.readOnly") : t("screens.s02.addTooltip")}
              className="rounded-k bg-k-blue px-s-4 py-s-2 text-fs-14 font-bold text-k-white disabled:opacity-50"
            >
              {t("buttons.add")}
            </button>
          )
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-center gap-s-3">
          <FacetFilter label={t("screens.s02.filters.unit")} options={unitOptions} selected={query.unit} onToggle={(v) => toggleFacet("unit", v)} />
          <FacetFilter label={t("screens.s02.filters.phase")} options={phaseOptions} selected={query.phase} onToggle={(v) => toggleFacet("phase", v)} />
          <FacetFilter
            label={t("screens.s02.filters.category")}
            options={categoryOptions}
            selected={query.category}
            onToggle={(v) => toggleFacet("category", v)}
          />
          <FacetFilter label={t("screens.s02.filters.rag")} options={ragOptions} selected={query.rag} onToggle={(v) => toggleFacet("rag", v)} />
          <label className="flex items-center gap-s-2">
            <span className="sr-only">{t("screens.s02.searchLabel")}</span>
            <input
              type="search"
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("screens.s02.searchPlaceholder")}
              aria-label={t("screens.s02.searchLabel")}
              className="rounded-k border border-k-grey px-s-3 py-s-2 text-fs-14"
            />
          </label>
        </div>
        <FilterBar filters={filterItems} onChange={handleFilterBarChange} savedViews={savedViews} onSaveView={handleSaveView} />
      </div>

      {showCards && (
        <div className="tablet:hidden">
          <ProjectCards items={data.items} unitNameById={unitNameById} />
        </div>
      )}
      <div className={showCards ? "hidden tablet:block" : undefined} onClick={handleHeaderClick}>
        <Table<ProjectSummary>
          tableId="s02-projects"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          captionKey="screens.s02.caption"
          state={tableState}
          density="dense"
          skeletonRows={query.pageSize > 12 ? 12 : query.pageSize}
          emptyState={{ messageKey: "screens.s02.empty", actionLabelKey: "screens.s02.clearFilters", onAction: clearFilters }}
          onExport={handleExport}
          onRowOpen={(row) => router.push(`/projects/${encodeURIComponent(row.id)}`)}
          onRetry={onRetry}
        />
      </div>

      {(state === "default" || state === "offline") && data && (
        <div className="mt-s-3 flex items-center justify-end gap-s-3">
          <button
            type="button"
            onClick={() => navigate({ ...query, page: page - 1 })}
            disabled={page <= 1}
            aria-label={t("screens.s02.prevPage")}
            className="rounded-k border border-k-grey p-s-1 text-k-blue-deep disabled:opacity-30"
          >
            <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <p className="num text-fs-14 text-k-text">{t("screens.s02.pagination", { from, to, total })}</p>
          <button
            type="button"
            onClick={() => navigate({ ...query, page: page + 1 })}
            disabled={to >= total}
            aria-label={t("screens.s02.nextPage")}
            className="rounded-k border border-k-grey p-s-1 text-k-blue-deep disabled:opacity-30"
          >
            <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
