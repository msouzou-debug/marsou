"use client";

// S23a «Εξαιρέσεις έργων» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * ExceptionsBody — the projects at red or amber with their reason and
 * owner, in the order the API sends them.
 *
 * | Prop     | Type              | Notes                          |
 * |----------|-------------------|--------------------------------|
 * | report   | ExceptionsReport? | Absent while loading.          |
 * | state    | BodyState         |                                |
 * | onExport | () => void        |                                |
 *
 * RULE (contract `ExceptionsReport`): red first, then amber, then by
 * slippage — the API's order is kept as the default; a header click
 * re-sorts on the screen only.
 */
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ExceptionRow, ExceptionsReport } from "@ecapital/shared";
import { RagChip, type RagValue } from "@/components/rag-chip";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR, formatInt } from "@/lib/format";
import { DASH, Slippage, eurOrDash } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.EXCEPTIONS";
const RAG_ORDER = { RED: 0, AMBER: 1, GREEN: 2 } as const;

export function ExceptionsBody({ report, state, onExport, onRetry }: BodyProps<ExceptionsReport>) {
  const t = useTranslations();
  const rows = report?.rows ?? [];

  const columns: TableColumn<ExceptionRow>[] = [
    {
      id: "code",
      headerKey: `${P}.columns.code`,
      accessor: (r) => r.projectCode,
      cell: (r) => (
        <Link href={`/projects/${encodeURIComponent(r.projectId)}`} className="whitespace-nowrap font-k-mono text-k-blue underline-offset-2 hover:underline">
          {r.projectCode}
        </Link>
      ),
    },
    { id: "title", headerKey: `${P}.columns.title`, accessor: (r) => r.titleEl },
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitName },
    { id: "phase", headerKey: `${P}.columns.phase`, accessor: (r) => r.phase, cell: (r) => (t.has(`phases.${r.phase}`) ? t(`phases.${r.phase}`) : r.phase) },
    { id: "rag", headerKey: `${P}.columns.rag`, accessor: (r) => RAG_ORDER[r.rag], cell: (r) => <RagChip value={r.rag.toLowerCase() as RagValue} /> },
    { id: "reason", headerKey: `${P}.columns.reason`, accessor: (r) => r.ragReason },
    { id: "owner", headerKey: `${P}.columns.owner`, accessor: (r) => r.ownerName ?? "", cell: (r) => r.ownerName ?? DASH },
    { id: "approved", headerKey: `${P}.columns.approved`, accessor: (r) => r.approved, numeric: true, cell: (r) => formatEUR(r.approved) },
    { id: "forecast", headerKey: `${P}.columns.forecast`, accessor: (r) => r.forecast ?? -Infinity, numeric: true, cell: (r) => eurOrDash(r.forecast) },
    { id: "slippage", headerKey: `${P}.columns.slippage`, accessor: (r) => r.slippage ?? -Infinity, numeric: true, cell: (r) => <Slippage value={r.slippage} /> },
    {
      id: "milestoneLate",
      headerKey: `${P}.columns.milestoneLate`,
      accessor: (r) => r.milestoneLateDays ?? -1,
      numeric: true,
      cell: (r) => (r.milestoneLateDays === null ? DASH : t("common.days", { count: formatInt(r.milestoneLateDays) })),
    },
    { id: "risksHigh", headerKey: `${P}.columns.risksHigh`, accessor: (r) => r.openRisksHigh, numeric: true, cell: (r) => formatInt(r.openRisksHigh) },
  ];

  return (
    <Table<ExceptionRow>
      tableId="s23a-exceptions"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.projectId}
      captionKey={`${P}.caption`}
      state={tableState(state, rows.length)}
      density="comfortable"
      onExport={onExport}
      onRetry={onRetry}
      emptyState={EMPTY}
    />
  );
}
