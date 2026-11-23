"use client";

// S23a «Συμφωνία SAP με eFinance» — ADR-0036
//
/**
 * SapReconciliationBody — per contract (or per vendor where SAP's line found
 * no contract) what SAP posted on the capital accounts against what
 * eFinance booked, for the period; the difference and a status chip; a
 * totals row; and a line under the table with the SAP lines still in the
 * unmatched queue, linking to S10.
 *
 * | Prop     | Type                     | Notes                                     |
 * |----------|--------------------------|-------------------------------------------|
 * | report   | SapReconciliationReport? | Absent while loading.                     |
 * | state    | BodyState                |                                           |
 * | onExport | () => void               | The table's own export button.            |
 *
 * RULE (ADR-0036 §3): this report never adds a second spent figure; it only
 * compares the two sources. The totals row comes from the API's `totals`
 * (the same figures the workbook's formulas sum), the line counts are summed
 * here.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { SapReconciliationReport, SapReconciliationRow, SapReconciliationStatus } from "@ecapital/shared";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR, formatInt } from "@/lib/format";
import { DASH } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.SAP_RECONCILIATION";

/** Existing chip colours: green agrees, amber differs, red-ish where only one side has the money. */
export const STATUS_TINT: Record<SapReconciliationStatus, string> = {
  MATCHED: "bg-k-green-bg",
  DIFFERENCE: "bg-k-amber-bg",
  SAP_ONLY: "bg-k-red-bg",
  EFINANCE_ONLY: "bg-k-red-bg",
};

export function StatusChip({ status }: { status: SapReconciliationStatus }) {
  const t = useTranslations();
  return <span className={`inline-block whitespace-nowrap rounded-k-chip px-s-2 text-k-ink ${STATUS_TINT[status]}`}>{t(`${P}.status.${status}`)}</span>;
}

/** A row's identity for the table: contracts are unique, a vendor-only row is keyed by vendor and index. */
const rowId = (r: SapReconciliationRow, index: number) => r.contractId ?? `vendor-${r.vendorNo ?? "none"}-${index}`;

export function SapReconciliationBody({ report, state, onExport, onRetry }: BodyProps<SapReconciliationReport>) {
  const t = useTranslations();
  const rows = report?.rows ?? [];
  const dash = (value: string | null) => value ?? DASH;

  const columns: TableColumn<SapReconciliationRow>[] = [
    { id: "contract", headerKey: `${P}.columns.contract`, accessor: (r) => r.contractRef ?? "", cell: (r) => r.contractRef ?? t(`${P}.noContract`) },
    { id: "project", headerKey: `${P}.columns.project`, accessor: (r) => r.projectCode ?? "", cell: (r) => dash(r.projectCode) },
    { id: "unit", headerKey: `${P}.columns.unit`, accessor: (r) => r.orgUnitName ?? "", cell: (r) => dash(r.orgUnitName) },
    { id: "contractor", headerKey: `${P}.columns.contractor`, accessor: (r) => r.contractorName ?? "", cell: (r) => dash(r.contractorName) },
    { id: "vendorNo", headerKey: `${P}.columns.vendorNo`, accessor: (r) => r.vendorNo ?? "", cell: (r) => dash(r.vendorNo) },
    { id: "sapLines", headerKey: `${P}.columns.sapLines`, accessor: (r) => r.sapLines, numeric: true, cell: (r) => formatInt(r.sapLines) },
    { id: "sapAmount", headerKey: `${P}.columns.sapAmount`, accessor: (r) => r.sapAmount, numeric: true, cell: (r) => formatEUR(r.sapAmount) },
    { id: "efinanceInvoices", headerKey: `${P}.columns.efinanceInvoices`, accessor: (r) => r.efinanceInvoices, numeric: true, cell: (r) => formatInt(r.efinanceInvoices) },
    { id: "efinanceAmount", headerKey: `${P}.columns.efinanceAmount`, accessor: (r) => r.efinanceAmount, numeric: true, cell: (r) => formatEUR(r.efinanceAmount) },
    { id: "difference", headerKey: `${P}.columns.difference`, accessor: (r) => r.difference, numeric: true, cell: (r) => formatEUR(r.difference) },
    { id: "status", headerKey: `${P}.columns.status`, accessor: (r) => r.status, cell: (r) => <StatusChip status={r.status} /> },
    { id: "linesWithoutRef", headerKey: `${P}.columns.linesWithoutRef`, accessor: (r) => r.linesWithoutRef, numeric: true, cell: (r) => formatInt(r.linesWithoutRef) },
  ];

  const sum = (pick: (r: SapReconciliationRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  const totals = report?.totals;

  return (
    <div className="flex flex-col gap-s-3">
      <Table<SapReconciliationRow>
        tableId="s23a-sap-reconciliation"
        columns={columns}
        rows={rows}
        getRowId={(r) => rowId(r, rows.indexOf(r))}
        captionKey={`${P}.caption`}
        state={tableState(state, rows.length)}
        density="comfortable"
        onExport={onExport}
        onRetry={onRetry}
        emptyState={EMPTY}
        totals={
          totals
            ? {
                contract: t("screens.s23a.total"),
                sapLines: formatInt(sum((r) => r.sapLines)),
                sapAmount: formatEUR(totals.sapAmount),
                efinanceInvoices: formatInt(sum((r) => r.efinanceInvoices)),
                efinanceAmount: formatEUR(totals.efinanceAmount),
                difference: formatEUR(totals.difference),
                linesWithoutRef: formatInt(sum((r) => r.linesWithoutRef)),
              }
            : undefined
        }
      />
      {report && (
        <p data-testid="sap-unmatched" className="text-fs-14 text-k-ink">
          {t(`${P}.unmatched`, { count: report.unmatchedLines, amount: formatEUR(report.unmatchedAmount) })}{" "}
          <Link href="/cost/imports" className="text-k-blue underline-offset-2 hover:underline print:hidden">
            {t(`${P}.unmatchedLink`)}
          </Link>
        </p>
      )}
      {report && <p className="text-fs-14 text-k-text">{t(`${P}.note`)}</p>}
    </div>
  );
}
