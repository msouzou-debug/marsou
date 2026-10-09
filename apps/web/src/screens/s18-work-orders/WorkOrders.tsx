"use client";

// S18 «Εντολές εργασίας» — R33, R34 (ADR-0031)
//
/**
 * WorkOrders — the pure S18 list body: six KpiTiles from the summary, the
 * filter controls plus FilterBar, the Table on tablet/desktop and cards on a
 * phone. Same Screen/pure split and filter posture as S16a (`Assets.tsx`):
 * filters live in this screen's own state, mirrored to the URL by FilterBar.
 *
 * | Prop             | Type                       | Notes                                                       |
 * |------------------|----------------------------|-------------------------------------------------------------|
 * | summary          | MaintenanceSummary?        | The six tiles.                                              |
 * | summaryState     | "default"\|"loading"\|"error" | The tiles' own state; the list has its own.              |
 * | data             | {items, total}?            | Ignored in `noPermission` \| `loading` \| `error`.          |
 * | state            | WorkOrdersScreenState      | The five states (UI instructions §6) plus default.           |
 * | filters          | WorkOrdersFilters          | Fully controlled.                                           |
 * | orgUnits         | OrgUnit[]                  | The unit filter.                                            |
 * | canRaise         | boolean                    | `canRaiseWorkOrder` — «Νέα κλήση».                          |
 * | canViewScorecard | boolean                    | `canViewScorecard` — «Αξιολόγηση».                          |
 * | onExport         | () => void?                | Table export (the list has no xlsx route of its own yet).   |
 *
 * RULE (task S18): default sort is the call time, newest first — the
 * Screen asks the API for `sort=calledAt&dir=desc` and the table keeps the
 * order it was given until a header is pressed.
 *
 * RULE (ADR-0031 §3): three timer columns — response, restore, report. A
 * PM order has one deadline, its programme date, so it shows only that
 * chip in the restore column and «—» in the other two.
 *
 * RULE (ADR-0031 §4): escalation is a flag. The «Κλιμάκωση» column shows
 * it in red, with a text label, never colour alone.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  MaintenanceSummary,
  OrgUnit,
  SlaBand,
  SlaState,
  WorkOrderKind,
  WorkOrderListRow,
  WorkOrderStatus,
} from "@ecapital/shared";
import { PageTitle } from "@/components/app-shell";
import { FilterBar, type FilterItem } from "@/components/filter-bar";
import { KpiTile } from "@/components/kpi-tile";
import { Table, type TableColumn, type TableState } from "@/components/table";
import type { Locale } from "@/i18n/config";
import { formatDateTime, formatEUR, formatInt, shortSystemName } from "@/lib/format";
import { BandChip } from "./BandChip";
import { WorkOrderCards } from "./WorkOrderCards";
import { EscalatedMark, rowTimers } from "./WorkOrderTimer";

export type WorkOrdersScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface WorkOrdersFilters {
  unit: string;
  kind: WorkOrderKind | "";
  status: WorkOrderStatus[];
  band: SlaBand | "";
  slaState: SlaState | "";
  q: string;
}

export const NO_WORK_ORDER_FILTERS: WorkOrdersFilters = { unit: "", kind: "", status: [], band: "", slaState: "", q: "" };

export interface WorkOrdersProps {
  summary?: MaintenanceSummary;
  summaryState: "default" | "loading" | "error";
  data?: { items: WorkOrderListRow[]; total: number };
  state: WorkOrdersScreenState;
  filters: WorkOrdersFilters;
  orgUnits: OrgUnit[];
  onFilters: (next: WorkOrdersFilters) => void;
  /** Paging (owner, 09/10/2026): the current page, its size and the setter. Absent = everything on one page. */
  page?: number;
  pageSize?: number;
  onPage?: (page: number) => void;
  onRetry?: () => void;
  onExport?: () => void;
  canRaise: boolean;
  canViewScorecard: boolean;
  noPermission: ReactNode;
}

export const KIND_OPTIONS: WorkOrderKind[] = ["CORRECTIVE", "PM", "STATUTORY"];
export const STATUS_OPTIONS: WorkOrderStatus[] = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "PAUSED", "RESTORED", "COMPLETED", "CANCELLED"];
export const BAND_OPTIONS: SlaBand[] = ["CRITICAL", "P1", "P2"];
const SLA_STATE_OPTIONS: SlaState[] = ["GREEN", "AMBER", "RED", "BREACHED"];

export function WorkOrders(props: WorkOrdersProps) {
  const { summary, summaryState, data, state, filters, orgUnits, onFilters, onRetry, onExport, canRaise, canViewScorecard, noPermission } = props;
  const page = props.page ?? 1;
  const pageSize = props.pageSize ?? Math.max(1, data?.items.length ?? 1);
  const total = data?.total ?? 0;
  const pageFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageTo = Math.min(page * pageSize, total);
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();

  if (state === "noPermission") return <>{noPermission}</>;

  const unitNameById = new Map(orgUnits.map((u) => [u.id, locale === "en" ? u.nameEn : u.nameEl] as const));

  const filterItems: FilterItem[] = [
    ...(filters.unit ? [{ key: "unit", label: t("common.unit"), value: unitNameById.get(filters.unit) ?? filters.unit }] : []),
    ...(filters.kind ? [{ key: "kind", label: t("screens.s18.filters.kind"), value: t(`workOrderKind.${filters.kind}`) }] : []),
    ...(filters.status.length
      ? [{ key: "status", label: t("common.status"), value: filters.status.map((s) => t(`workOrderStatus.${s}`)).join(", ") }]
      : []),
    ...(filters.band ? [{ key: "band", label: t("screens.s18.filters.band"), value: t(`slaBand.${filters.band}`) }] : []),
    ...(filters.slaState ? [{ key: "sla", label: t("screens.s18.filters.slaState"), value: t(`slaState.${filters.slaState}`) }] : []),
    ...(filters.q.trim() ? [{ key: "q", label: t("common.search"), value: filters.q.trim() }] : []),
  ];

  function handleFilterBarChange(next: FilterItem[]) {
    const keys = new Set(next.map((f) => f.key));
    onFilters({
      unit: keys.has("unit") ? filters.unit : "",
      kind: keys.has("kind") ? filters.kind : "",
      status: keys.has("status") ? filters.status : [],
      band: keys.has("band") ? filters.band : "",
      slaState: keys.has("sla") ? filters.slaState : "",
      q: keys.has("q") ? filters.q : "",
    });
  }

  // RULE (owner, 09/10/2026): one status at a time. The field stays an array
  // because the API accepts several, but the screen offers a single pick;
  // pressing the active chip again clears it («all statuses»).
  function toggleStatus(status: WorkOrderStatus) {
    const has = filters.status.includes(status);
    onFilters({ ...filters, status: has ? [] : [status] });
  }

  const columns: TableColumn<WorkOrderListRow>[] = [
    {
      id: "ref",
      headerKey: "screens.s18.columns.ref",
      accessor: (row) => row.ref,
      cell: (row) => (
        <Link href={`/maintenance/${encodeURIComponent(row.id)}`} className="whitespace-nowrap font-k-mono text-k-blue hover:underline">
          {row.ref}
        </Link>
      ),
    },
    { id: "kind", headerKey: "screens.s18.columns.kind", accessor: (row) => row.kind, cell: (row) => t(`workOrderKind.${row.kind}`) },
    {
      id: "band",
      headerKey: "screens.s18.columns.band",
      accessor: (row) => (row.band ? BAND_OPTIONS.indexOf(row.band) : 9),
      cell: (row) => <BandChip band={row.band} />,
    },
    { id: "system", headerKey: "screens.s18.columns.system", accessor: (row) => row.slaSystemName ?? "", cell: (row) => (row.slaSystemName ? shortSystemName(row.slaSystemName) : t("common.notAvailable")) },
    {
      id: "asset",
      headerKey: "screens.s18.columns.asset",
      accessor: (row) => row.assetTag ?? "",
      cell: (row) =>
        row.assetTag ? (
          <span>
            <span className="font-k-mono">{row.assetTag}</span>
            {row.assetName ? <span className="block text-fs-12 text-k-text">{row.assetName}</span> : null}
          </span>
        ) : (
          t("common.notAvailable")
        ),
    },
    { id: "title", headerKey: "screens.s18.columns.title", accessor: (row) => row.titleEl },
    { id: "calledAt", headerKey: "screens.s18.columns.calledAt", accessor: (row) => row.calledAt, numeric: true, cell: (row) => formatDateTime(row.calledAt) },
    { id: "response", headerKey: "screens.s18.columns.response", accessor: (row) => row.dueResponseAt ?? "", sortable: false, cell: (row) => rowTimers(row).response },
    { id: "restore", headerKey: "screens.s18.columns.restore", accessor: (row) => row.dueRestoreAt ?? row.dueDate ?? "", sortable: false, cell: (row) => rowTimers(row).restore },
    { id: "report", headerKey: "screens.s18.columns.report", accessor: (row) => row.dueReportAt ?? "", sortable: false, cell: (row) => rowTimers(row).report },
    { id: "status", headerKey: "common.status", accessor: (row) => STATUS_OPTIONS.indexOf(row.status), cell: (row) => t(`workOrderStatus.${row.status}`) },
    {
      id: "escalated",
      headerKey: "screens.s18.columns.escalated",
      accessor: (row) => (row.escalatedAt ? 1 : 0),
      cell: (row) => (row.escalatedAt ? <EscalatedMark /> : null),
    },
  ];

  const tableState: TableState = state === "default" ? "default" : state;
  const showCards = (state === "default" || state === "offline") && !!data;
  const tileState = summaryState;
  const value = (n: number | undefined) => (n === undefined ? "" : formatInt(n));

  const linkClass = "flex min-h-[44px] items-center rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep";

  return (
    <>
      <PageTitle
        eyebrow={t("nav.maintenance")}
        title={t("screens.s18.title")}
        action={
          <div className="flex flex-wrap items-center gap-s-3">
            <Link href="/maintenance/plan" className={linkClass}>
              {t("screens.s18.actions.plan")}
            </Link>
            <Link href="/maintenance/backlog" className={linkClass}>
              {t("screens.s18.actions.backlog")}
            </Link>
            {canViewScorecard && (
              <Link href="/maintenance/scorecard" className={linkClass}>
                {t("screens.s18.actions.scorecard")}
              </Link>
            )}
            {canRaise && state !== "offline" && (
              <Link href="/maintenance/new" className="flex min-h-[44px] items-center rounded-k bg-k-blue px-s-4 text-fs-14 font-bold text-k-white shadow-k">
                {t("screens.s18.actions.newCall")}
              </Link>
            )}
          </div>
        }
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <div className="mb-s-6 grid grid-cols-2 gap-s-4 tablet:grid-cols-3 desktop:grid-cols-6">
        <KpiTile label={t("screens.s18.kpi.open")} value={value(summary?.open)} state={tileState} />
        <KpiTile label={t("screens.s18.kpi.overdueResponse")} value={value(summary?.overdueResponse)} state={tileState} />
        <KpiTile label={t("screens.s18.kpi.overdueRestore")} value={value(summary?.overdueRestore)} state={tileState} />
        <KpiTile label={t("screens.s18.kpi.pmDueThisMonth")} value={value(summary?.pmDueThisMonth)} state={tileState} />
        <KpiTile label={t("screens.s18.kpi.pmOverdue")} value={value(summary?.pmOverdue)} state={tileState} />
        <KpiTile
          label={t("screens.s18.kpi.backlogUnfunded")}
          value={summary ? formatEUR(summary.backlogUnfundedEur) : ""}
          state={tileState}
        />
      </div>

      <div className="mb-s-4 flex flex-col gap-s-3">
        <div className="flex flex-wrap items-end gap-s-3">
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("common.unit")}
            <select value={filters.unit} onChange={(e) => onFilters({ ...filters, unit: e.target.value })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {orgUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitNameById.get(u.id)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18.filters.kind")}
            <select value={filters.kind} onChange={(e) => onFilters({ ...filters, kind: e.target.value as WorkOrderKind | "" })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {t(`workOrderKind.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18.filters.band")}
            <select value={filters.band} onChange={(e) => onFilters({ ...filters, band: e.target.value as SlaBand | "" })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {BAND_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {t(`slaBand.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18.filters.slaState")}
            <select value={filters.slaState} onChange={(e) => onFilters({ ...filters, slaState: e.target.value as SlaState | "" })} className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14">
              <option value="">{t("screens.s18.filters.all")}</option>
              {SLA_STATE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`slaState.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-s-1 text-fs-14 text-k-text">
            {t("screens.s18.searchLabel")}
            <input
              type="search"
              value={filters.q}
              onChange={(e) => onFilters({ ...filters, q: e.target.value })}
              placeholder={t("screens.s18.searchPlaceholder")}
              className="min-h-[44px] rounded-k border border-k-grey p-s-2 text-fs-14"
            />
          </label>
        </div>
        {/* One status at a time (owner, 09/10/2026); the chips behave like radio
            buttons and the active one clears on a second press. */}
        <fieldset role="radiogroup" className="flex flex-wrap items-center gap-s-2">
          <legend className="mb-s-1 text-fs-14 text-k-text">{t("common.status")}</legend>
          {STATUS_OPTIONS.map((s) => {
            const on = filters.status.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggleStatus(s)}
                className={`min-h-[44px] rounded-k-chip border px-s-3 text-fs-14 ${on ? "border-k-blue-deep bg-k-blue-bg text-k-ink" : "border-k-grey bg-k-white text-k-text"}`}
              >
                {t(`workOrderStatus.${s}`)}
              </button>
            );
          })}
        </fieldset>
        <FilterBar filters={filterItems} onChange={handleFilterBarChange} savedViews={[]} onSaveView={() => undefined} />
      </div>

      {showCards && (
        <div className="tablet:hidden">
          <WorkOrderCards items={data.items} />
        </div>
      )}
      <div className={showCards ? "hidden tablet:block" : undefined}>
        <Table<WorkOrderListRow>
          tableId="s18-work-orders"
          columns={columns}
          rows={data?.items ?? []}
          getRowId={(row) => row.id}
          captionKey="screens.s18.caption"
          state={tableState}
          density="dense"
          onRowOpen={(row) => router.push(`/maintenance/${encodeURIComponent(row.id)}`)}
          onExport={onExport ?? (() => undefined)}
          onRetry={onRetry}
          emptyState={{
            messageKey: "screens.s18.empty",
            actionLabelKey: "buttons.add",
            onAction: canRaise && state !== "offline" ? () => router.push("/maintenance/new") : undefined,
          }}
        />
      </div>
      {(state === "default" || state === "offline") && data && props.onPage && total > pageSize && (
        <nav aria-label={t("common.pagination", { from: pageFrom, to: pageTo, total })} className="mt-s-3 flex items-center justify-end gap-s-3">
          <button
            type="button"
            onClick={() => props.onPage?.(page - 1)}
            disabled={page <= 1}
            aria-label={t("common.prevPage")}
            className="min-h-[44px] min-w-[44px] rounded-k border border-k-grey p-s-1 text-k-blue-deep disabled:opacity-30"
          >
            <ChevronLeft size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <p className="num text-fs-14 text-k-text">{t("common.pagination", { from: pageFrom, to: pageTo, total })}</p>
          <button
            type="button"
            onClick={() => props.onPage?.(page + 1)}
            disabled={pageTo >= total}
            aria-label={t("common.nextPage")}
            className="min-h-[44px] min-w-[44px] rounded-k border border-k-grey p-s-1 text-k-blue-deep disabled:opacity-30"
          >
            <ChevronRight size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </nav>
      )}
    </>
  );
}
