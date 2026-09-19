"use client";

// S04 — R13, R16, R17, R31 (UI instructions §5 S04, §7 glossary)
//
/**
 * Cost — the pure S04 screen body: the project tab strip, the whole-project
 * `CostBar`, the `WarningStrip`, the dense cost-by-category table with its
 * bold totals footer, «Παράμετροι πρόβλεψης» (`ForecastInputsForm`),
 * «Ταμειακή ροή» (`CashflowSection`) and, for finance/admin only,
 * «Γραμμές προϋπολογισμού» (`BudgetLinesEditor`).
 *
 * | Prop                | Type              | Notes                                                          |
 * |---------------------|-------------------|--------------------------------------------------------------------|
 * | data                | ProjectCost?      | Ignored in `noPermission` \| `loading` \| `error`.                     |
 * | projectTitle/projectCode | string?      | For the page header — from the separate `ProjectDetail` fetch, so a slow/failed one never blocks the cost data itself. |
 * | state               | CostScreenState   | No `empty` — a project always has ledgers once it exists (CAPEX-01 §7: `approved` is never null), same reasoning `ContractOverview`'s header comment gives. |
 * | roles               | AppRole[]         | Gates the forecast-inputs form, the warning dismiss link and the budget-lines editor. |
 * | onRetry             | () => void?       |                                                                      |
 * | noPermission        | ReactNode         |                                                                      |
 * | onDismissWarning    | (id) => void      |                                                                      |
 * | dismissingWarningId | string?           |                                                                      |
 * | onSaveForecastInputs| (values) => void  |                                                                      |
 * | forecastSaving/forecastApiError | —     |                                                                      |
 * | onExport            | () => void        | `GET /projects/:id/cost/export`.                                     |
 * | exporting           | boolean           | Disables the export button while the download is in flight.          |
 * | cashflow…           | —                 | Forwarded to `CashflowSection` — see that component's own props.      |
 * | budgetLines…        | —                 | Forwarded to `BudgetLinesEditor`, mounted only for `canManageBudgetLines`. |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, CashflowRow, ProjectCost } from "@ecapital/shared";
import { canManageBudgetLines, canDismissCostWarning, canSetForecastInputs } from "@/auth/roles";
import { PageTitle } from "@/components/app-shell";
import { CostBar } from "@/components/cost-bar";
import { Table, type TableColumn } from "@/components/table";
import { WarningStrip } from "@/components/warning-strip";
import { formatEURorDash } from "@/lib/format";
import { ProjectTabs } from "@/screens/s03-project/ProjectTabs";
import type { BudgetLine } from "@ecapital/shared";
import { BudgetLinesEditor, type BudgetLineDraftRow } from "./BudgetLinesEditor";
import { CashflowSection, type CashflowSectionState } from "./CashflowSection";
import { ForecastInputsForm } from "./ForecastInputsForm";
import type { ForecastInputsFormValues } from "./schema";

export type CostScreenState = "default" | "loading" | "error" | "noPermission" | "offline";

type CategoryRow = ProjectCost["categories"][number];

const KNOWN_CATEGORIES = ["works", "equipment", "fees", "contingency", "other", "uncategorised"];

export interface CostProps {
  data?: ProjectCost;
  projectTitle?: string;
  projectCode?: string;
  projectId: string;
  state: CostScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  onDismissWarning: (warningId: string) => void;
  dismissingWarningId?: string;
  onSaveForecastInputs: (values: ForecastInputsFormValues) => void;
  forecastSaving?: boolean;
  forecastApiError?: string;
  onExport: () => void;
  exporting?: boolean;
  cashflowRows?: CashflowRow[];
  cashflowState: CashflowSectionState;
  cashflowFrom: string;
  cashflowTo: string;
  onCashflowRangeChange: (from: string, to: string) => void;
  budgetLines?: BudgetLine[];
  budgetYear: number;
  onBudgetYearChange: (year: number) => void;
  onSaveBudgetLines: (rows: BudgetLineDraftRow[]) => void;
  budgetLinesSaving?: boolean;
  budgetLinesApiError?: string;
}

export function Cost({
  data,
  projectTitle,
  projectCode,
  projectId,
  state,
  onRetry,
  noPermission,
  roles = [],
  onDismissWarning,
  dismissingWarningId,
  onSaveForecastInputs,
  forecastSaving = false,
  forecastApiError,
  onExport,
  exporting = false,
  cashflowRows,
  cashflowState,
  cashflowFrom,
  cashflowTo,
  onCashflowRangeChange,
  budgetLines,
  budgetYear,
  onBudgetYearChange,
  onSaveBudgetLines,
  budgetLinesSaving = false,
  budgetLinesApiError,
}: CostProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  function categoryLabel(category: string): string {
    return KNOWN_CATEGORIES.includes(category) ? t(`screens.s04.categories.${category}`) : category;
  }

  const columns: TableColumn<CategoryRow>[] = [
    { id: "category", headerKey: "screens.s04.columns.category", accessor: (row) => row.category, cell: (row) => categoryLabel(row.category) },
    { id: "approved", headerKey: "screens.s04.columns.approved", accessor: (row) => row.approved, numeric: true, cell: (row) => formatEURorDash(row.approved) },
    { id: "committed", headerKey: "screens.s04.columns.committed", accessor: (row) => row.committed, numeric: true, cell: (row) => formatEURorDash(row.committed) },
    { id: "spent", headerKey: "screens.s04.columns.spent", accessor: (row) => row.spent, numeric: true, cell: (row) => formatEURorDash(row.spent) },
    { id: "forecast", headerKey: "screens.s04.columns.forecast", accessor: (row) => row.forecast, numeric: true, cell: (row) => formatEURorDash(row.forecast) },
    {
      id: "variance",
      headerKey: "screens.s04.columns.variance",
      accessor: (row) => row.variance,
      numeric: true,
      // RULE (contract `CostCategoryRow`, build brief §5 S04): variance is
      // forecast − approved, and it is red only when it is negative — the
      // API's own sign convention, rendered as-is.
      cell: (row) => (
        <span className={row.variance !== null && row.variance < 0 ? "text-k-red" : undefined}>
          {formatEURorDash(row.variance)}
        </span>
      ),
    },
  ];

  function sumOrNull(values: Array<number | null>): number | null {
    if (values.every((v) => v === null)) return null;
    return values.reduce((sum: number, v) => sum + (v ?? 0), 0);
  }

  const categories = data?.categories ?? [];
  const totalsApproved = sumOrNull(categories.map((c) => c.approved));
  const totalsForecast = sumOrNull(categories.map((c) => c.forecast));
  const totals = {
    approved: totalsApproved,
    committed: sumOrNull(categories.map((c) => c.committed)),
    spent: sumOrNull(categories.map((c) => c.spent)),
    forecast: totalsForecast,
    // RULE (build brief §5 S04): Απόκλιση is forecast − approved, computed on
    // the totals themselves rather than summed from the per-category values,
    // which are null whenever a single category has an incomplete ledger and
    // would otherwise mask a totals row that has both figures.
    variance: totalsApproved !== null && totalsForecast !== null ? totalsForecast - totalsApproved : null,
  };

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : categories.length === 0 && state === "default" ? "empty" : "default";

  const canDismiss = canDismissCostWarning(roles);
  const canEditForecast = canSetForecastInputs(roles);
  const canEditBudgetLines = canManageBudgetLines(roles);

  return (
    <>
      <PageTitle
        eyebrow={projectCode ?? ""}
        title={projectTitle ?? t("screens.s04.title")}
        tabs={<ProjectTabs projectId={projectId} active="cost" />}
      />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      {(state === "loading" || state === "error" || data) && (
        <div className="mb-s-5">
          <CostBar
            approved={data?.ledgers.approved ?? 0}
            committed={data?.ledgers.committed ?? null}
            spent={data?.ledgers.spent ?? null}
            forecast={data?.ledgers.forecast ?? null}
            state={state === "loading" ? "loading" : state === "error" ? "error" : "default"}
            onRetry={onRetry}
          />
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="mb-s-5">
          <WarningStrip
            warnings={data.warnings}
            canDismiss={canDismiss}
            dismissingId={dismissingWarningId}
            onDismiss={onDismissWarning}
          />
        </div>
      )}

      <div className="mb-s-5">
        <Table<CategoryRow>
          tableId="s04-cost-categories"
          columns={columns}
          rows={categories}
          getRowId={(row) => row.category}
          captionKey="screens.s04.caption"
          state={tableState}
          onExport={onExport}
          onRetry={onRetry}
          emptyState={{ messageKey: "screens.s04.empty", actionLabelKey: "buttons.save" }}
        />
        {state === "default" && categories.length > 0 && (
          <div className="flex items-center justify-between border-t-2 border-k-ink bg-k-white px-s-2 py-s-2 text-fs-14 font-bold text-k-ink">
            <span>{t("screens.s04.totalsRow")}</span>
            <div className="flex gap-s-6">
              <span className="num">{formatEURorDash(totals.approved)}</span>
              <span className="num">{formatEURorDash(totals.committed)}</span>
              <span className="num">{formatEURorDash(totals.spent)}</span>
              <span className="num">{formatEURorDash(totals.forecast)}</span>
              <span className={`num ${totals.variance !== null && totals.variance < 0 ? "text-k-red" : ""}`}>
                {formatEURorDash(totals.variance)}
              </span>
            </div>
          </div>
        )}
        {exporting && <p className="mt-s-2 text-fs-12 text-k-text-muted">{t("common.loading")}</p>}
      </div>

      {data && (
        <div className="mb-s-5">
          <ForecastInputsForm
            values={data.forecastInputs}
            canEdit={canEditForecast}
            saving={forecastSaving}
            apiError={forecastApiError}
            onSave={onSaveForecastInputs}
          />
        </div>
      )}

      <div className="mb-s-5">
        <CashflowSection
          rows={cashflowRows}
          state={cashflowState}
          from={cashflowFrom}
          to={cashflowTo}
          onRangeChange={onCashflowRangeChange}
          onExport={onExport}
        />
      </div>

      {canEditBudgetLines && (
        <BudgetLinesEditor
          lines={budgetLines ?? []}
          year={budgetYear}
          onYearChange={onBudgetYearChange}
          onSave={onSaveBudgetLines}
          saving={budgetLinesSaving}
          apiError={budgetLinesApiError}
        />
      )}
    </>
  );
}
