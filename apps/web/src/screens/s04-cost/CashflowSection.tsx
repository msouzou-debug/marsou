"use client";

// S04 — R17
//
/**
 * CashflowSection — «Ταμειακή ροή»: a from/to month picker, the month table
 * (planned/actual/cumulative) and `CashflowChart` underneath it (build brief
 * §5 S04). Defaults to the current year, same as the brief's "for the
 * current year" — the picker lets the caller move the window without
 * leaving the page.
 *
 * | Prop     | Type                              | Notes                                            |
 * |----------|-----------------------------------|-----------------------------------------------------|
 * | rows     | CashflowRow[]?                    | Undefined while loading.                              |
 * | state    | "default" \| "loading" \| "error" \| "empty" | Mirrors `CashflowChart`'s own states.     |
 * | from/to  | string                            | "YYYY-MM", controlled by the caller.                  |
 * | onRangeChange | (from, to) => void           |                                                        |
 * | onExport | () => void                        | Reuses S04's one export endpoint (the whole cost export carries the cash flow sheet too). |
 * | onRetry  | () => void                        |                                                        |
 */
import { useTranslations } from "next-intl";
import type { CashflowRow } from "@ecapital/shared";
import { CashflowChart } from "@/components/cashflow-chart";
import { Table, type TableColumn } from "@/components/table";
import { formatEURorDash } from "@/lib/format";

export type CashflowSectionState = "default" | "loading" | "error" | "empty";

export interface CashflowSectionProps {
  rows?: CashflowRow[];
  state: CashflowSectionState;
  from: string;
  to: string;
  onRangeChange: (from: string, to: string) => void;
  onExport?: () => void;
  onRetry?: () => void;
}

export function CashflowSection({ rows, state, from, to, onRangeChange, onExport, onRetry }: CashflowSectionProps) {
  const t = useTranslations();

  const columns: TableColumn<CashflowRow>[] = [
    { id: "period", headerKey: "screens.s04.cashflow.columns.period", accessor: (row) => row.period },
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

  return (
    <section className="rounded-k border border-k-grey bg-k-white p-s-4">
      <div className="flex flex-wrap items-end justify-between gap-s-4">
        <h2 className="text-fs-16 font-bold text-k-blue-deep">{t("screens.s04.cashflow.title")}</h2>
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
        </div>
      </div>

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
