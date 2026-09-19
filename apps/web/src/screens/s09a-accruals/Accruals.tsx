"use client";

// S09a — R18
//
/**
 * Accruals — the pure S09a screen: `CostNavTabs`, a year select and the
 * dense table of certified-but-not-yet-invoiced amounts, per project and
 * contract, with a bold totals footer. The export button downloads the
 * xlsx the API produces with live formulas (build brief §5 S09a) — this UI
 * only triggers the download, it never recomputes the totals itself.
 *
 * | Prop         | Type                | Notes                                             |
 * |--------------|---------------------|--------------------------------------------------------|
 * | data         | AccrualRow[]?       |                                                          |
 * | year         | number              |                                                          |
 * | onYearChange | (year: number) => void |                                                       |
 * | state        | AccrualsScreenState |                                                          |
 * | onExport     | () => void          | `GET /cost/accruals/export?year=…`                       |
 * | exporting    | boolean             |                                                          |
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AccrualRow, AppRole } from "@ecapital/shared";
import { CostNavTabs, PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR } from "@/lib/format";

export type AccrualsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface AccrualsProps {
  data?: AccrualRow[];
  year: number;
  onYearChange: (year: number) => void;
  state: AccrualsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  onExport: () => void;
  exporting?: boolean;
}

const YEAR_OPTIONS_SPAN = 4; // this year and the three before it

export function Accruals({ data, year, onYearChange, state, onRetry, noPermission, onExport, exporting = false }: AccrualsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const columns: TableColumn<AccrualRow>[] = [
    { id: "project", headerKey: "screens.s09a.columns.project", accessor: (row) => row.projectCode, cell: (row) => `${row.projectCode} · ${row.projectTitleEl}` },
    { id: "contract", headerKey: "screens.s09a.columns.contract", accessor: (row) => row.contractRef },
    { id: "contractor", headerKey: "screens.s09a.columns.contractor", accessor: (row) => row.contractorName },
    { id: "costCentre", headerKey: "screens.s09a.columns.costCentre", accessor: (row) => row.costCentre ?? "" , cell: (row) => row.costCentre ?? t("common.notAvailable") },
    { id: "certNumber", headerKey: "screens.s09a.columns.certNumber", accessor: (row) => row.certNumber, numeric: true },
    { id: "certifiedNet", headerKey: "screens.s09a.columns.certifiedNet", accessor: (row) => row.certifiedNet, numeric: true, cell: (row) => formatEUR(row.certifiedNet) },
    { id: "invoiced", headerKey: "screens.s09a.columns.invoiced", accessor: (row) => row.invoiced, numeric: true, cell: (row) => formatEUR(row.invoiced) },
    { id: "accrual", headerKey: "screens.s09a.columns.accrual", accessor: (row) => row.accrual, numeric: true, cell: (row) => formatEUR(row.accrual) },
    {
      id: "note",
      headerKey: "screens.s09a.columns.note",
      accessor: (row) => (row.overInvoiced ? t("screens.s09a.overInvoiced") : ""),
      // RULE (screenshot review 19/09/2026): a certificate with invoiced
      // above certified nets to an accrual of 0,00 € (API clamp, R18) — the
      // row stays, and this note is the only place that says why the
      // accrual reads zero instead of a negative figure.
      cell: (row) =>
        row.overInvoiced ? (
          <span className="rounded-k-chip bg-k-amber-bg px-s-2 py-[2px] text-fs-12 text-k-ink">
            {t("screens.s09a.overInvoiced")}
          </span>
        ) : null,
    },
  ];

  const rows = data ?? [];
  const totals = {
    certifiedNet: rows.reduce((sum, r) => sum + r.certifiedNet, 0),
    invoiced: rows.reduce((sum, r) => sum + r.invoiced, 0),
    accrual: rows.reduce((sum, r) => sum + r.accrual, 0),
  };

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_OPTIONS_SPAN }, (_, i) => currentYear - i);
  if (!years.includes(year)) years.push(year);

  return (
    <>
      <PageTitle
        eyebrow=""
        title={t("screens.s09a.title")}
        action={
          <label className="flex items-center gap-s-2 text-fs-14 text-k-text">
            {t("screens.s09a.year")}
            <select
              value={year}
              onChange={(e) => onYearChange(Number(e.target.value))}
              className="h-9 rounded-k border border-k-grey bg-k-white px-s-2 text-fs-14 text-k-ink"
            >
              {years.sort((a, b) => b - a).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <CostNavTabs />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <Table<AccrualRow>
        tableId="s09a-accruals"
        columns={columns}
        rows={rows}
        getRowId={(row) => `${row.contractId}-${row.certNumber}`}
        captionKey="screens.s09a.caption"
        state={tableState}
        onExport={onExport}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s09a.empty", actionLabelKey: "buttons.exportExcel" }}
      />
      {state === "default" && rows.length > 0 && (
        <div className="flex items-center justify-between border-t-2 border-k-ink bg-k-white px-s-2 py-s-2 text-fs-14 font-bold text-k-ink">
          <span>{t("screens.s09a.totalsRow")}</span>
          <div className="flex gap-s-6">
            <span className="num">{formatEUR(totals.certifiedNet)}</span>
            <span className="num">{formatEUR(totals.invoiced)}</span>
            <span className="num">{formatEUR(totals.accrual)}</span>
          </div>
        </div>
      )}
      {exporting && <p className="mt-s-2 text-fs-12 text-k-text-muted">{t("common.loading")}</p>}
    </>
  );
}
