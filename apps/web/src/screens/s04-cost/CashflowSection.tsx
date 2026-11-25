"use client";

// S04 — R17, ADR-0037
//
/**
 * CashflowSection — «Ταμειακή ροή»: a from/to month picker, the month table
 * (planned/actual/cumulative) and `CashflowChart` underneath it (build brief
 * §5 S04). Defaults to the current year, same as the brief's "for the
 * current year" — the picker lets the caller move the window without
 * leaving the page.
 *
 * ADR-0037: a line under the title says where «Προγραμματισμένα» comes
 * from — the project's cash-flow plan when it has one, else each year's
 * budget spread evenly over its months. For whoever writes the budget lines,
 * «Επεξεργασία πλάνου» opens `CashflowPlanEditor` in place.
 *
 * | Prop     | Type                              | Notes                                            |
 * |----------|-----------------------------------|-----------------------------------------------------|
 * | rows     | CashflowRow[]?                    | Undefined while loading.                              |
 * | state    | "default" \| "loading" \| "error" \| "empty" | Mirrors `CashflowChart`'s own states.     |
 * | from/to  | string                            | "YYYY-MM", controlled by the caller.                  |
 * | onRangeChange | (from, to) => void           |                                                        |
 * | onExport | () => void                        | Reuses S04's one export endpoint (the whole cost export carries the cash flow sheet too). |
 * | onRetry  | () => void                        |                                                        |
 * | plan     | CashflowPlan?                     | ADR-0037. Omitted: no source line and no editor (a fixture that predates it). |
 * | canEditPlan | boolean?                       | `canManageBudgetLines`. Shows «Επεξεργασία πλάνου».  |
 * | onSavePlan / onImportPlan / planTemplateHref | — | Forwarded to `CashflowPlanEditor`.        |
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CashflowPlan, CashflowPlanImportResult, CashflowPlanMonth, CashflowRow } from "@ecapital/shared";
import { CashflowChart } from "@/components/cashflow-chart";
import { Table, type TableColumn } from "@/components/table";
import { formatDateTime, formatEURorDash, formatPeriod } from "@/lib/format";
import { CashflowPlanEditor } from "./CashflowPlanEditor";

export type CashflowSectionState = "default" | "loading" | "error" | "empty";

export interface CashflowSectionProps {
  rows?: CashflowRow[];
  state: CashflowSectionState;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  onExport?: () => void;
  onRetry?: () => void;
  plan?: CashflowPlan;
  canEditPlan?: boolean;
  onSavePlan?: (months: CashflowPlanMonth[]) => Promise<void>;
  onImportPlan?: (file: File) => Promise<CashflowPlanImportResult>;
  planTemplateHref?: (from: string, to: string) => string;
}

export function CashflowSection({
  rows,
  state,
  from,
  to,
  onRangeChange,
  onExport,
  onRetry,
  plan,
  canEditPlan = false,
  onSavePlan,
  onImportPlan,
  planTemplateHref,
}: CashflowSectionProps) {
  const t = useTranslations();
  const [editing, setEditing] = useState(false);

  const columns: TableColumn<CashflowRow>[] = [
    {
      id: "period",
      headerKey: "screens.s04.cashflow.columns.period",
      accessor: (row) => row.period,
      cell: (row) => formatPeriod(row.period),
    },
    {
      id: "planned",
      headerKey: "screens.s04.cashflow.columns.planned",
      accessor: (row) => row.planned,
      numeric: true,
      cell: (row) => formatEURorDash(row.planned),
    },
    {
      id: "actual",
      headerKey: "screens.s04.cashflow.columns.actual",
      accessor: (row) => row.actual,
      numeric: true,
      cell: (row) => formatEURorDash(row.actual),
    },
    {
      id: "cumulativePlanned",
      headerKey: "screens.s04.cashflow.columns.cumulativePlanned",
      accessor: (row) => row.cumulativePlanned,
      numeric: true,
      cell: (row) => formatEURorDash(row.cumulativePlanned),
    },
    {
      id: "cumulativeActual",
      headerKey: "screens.s04.cashflow.columns.cumulativeActual",
      accessor: (row) => row.cumulativeActual,
      numeric: true,
      cell: (row) => formatEURorDash(row.cumulativeActual),
    },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : "default";
  const hasPlan = (plan?.months.length ?? 0) > 0;
  const canOpenEditor = canEditPlan && plan !== undefined && onSavePlan !== undefined && onImportPlan !== undefined && planTemplateHref !== undefined;

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex flex-wrap items-end justify-between gap-s-4">
        <div className="grid gap-s-1">
          <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s04.cashflow.title")}</h2>
          {/* RULE (ADR-0037): say which source «Προγραμματισμένα» is read from. */}
          {plan && (
            <p className="text-fs-14 text-k-text" data-testid="cashflow-source">
              {hasPlan ? t("screens.s04.cashflow.source.plan") : t("screens.s04.cashflow.source.budget")}
              {hasPlan && plan.updatedAt && plan.updatedByName && (
                <> {t("screens.s04.cashflow.source.planUpdated", { when: formatDateTime(plan.updatedAt), name: plan.updatedByName })}</>
              )}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-s-3">
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cashflow-from" className="text-fs-12 text-k-text">
              {t("screens.s04.cashflow.from")}
            </label>
            <input
              id="cashflow-from"
              type="month"
              value={from}
              onChange={(e) => onRangeChange(e.target.value, to)}
              className="h-9 rounded-k border border-k-grey px-s-2 text-fs-14 text-k-ink"
            />
          </div>
          <div className="flex flex-col gap-s-1">
            <label htmlFor="cashflow-to" className="text-fs-12 text-k-text">
              {t("screens.s04.cashflow.to")}
            </label>
            <input
              id="cashflow-to"
              type="month"
              value={to}
              onChange={(e) => onRangeChange(from, e.target.value)}
              className="h-9 rounded-k border border-k-grey px-s-2 text-fs-14 text-k-ink"
            />
          </div>
          {canOpenEditor && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex min-h-[44px] items-center rounded-k border border-k-grey px-s-3 text-fs-14 text-k-blue-deep"
            >
              {t("screens.s04.cashflowPlan.edit")}
            </button>
          )}
        </div>
      </div>

      {canOpenEditor && editing && plan && onSavePlan && onImportPlan && planTemplateHref && (
        <CashflowPlanEditor
          plan={plan}
          from={from}
          to={to}
          onSave={async (months) => {
            await onSavePlan(months);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onImport={onImportPlan}
          templateHref={planTemplateHref}
        />
      )}

      <div className="mt-s-4">
        <CashflowChart rows={rows ?? []} state={state === "loading" ? "loading" : state === "error" ? "error" : rows && rows.length > 0 ? "default" : "empty"} />
      </div>

      <div className="mt-s-4">
        <Table<CashflowRow>
          tableId="s04-cashflow"
          columns={columns}
          rows={rows ?? []}
          getRowId={(row) => row.period}
          captionKey="screens.s04.cashflow.caption"
          state={tableState}
          onExport={onExport}
          onRetry={onRetry}
          emptyState={{ messageKey: "screens.s04.cashflow.empty", actionLabelKey: "buttons.save" }}
        />
      </div>
    </section>
  );
}
