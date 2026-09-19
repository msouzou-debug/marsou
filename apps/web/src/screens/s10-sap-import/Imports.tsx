"use client";

// S10 — R14
//
/**
 * Imports — the pure S10 list screen: `CostNavTabs`, `UploadCard` and the
 * table of every SAP import batch (period, report, file, rows in/matched/
 * unmatched, status, imported by). Opening a row navigates to its own
 * unmatched-queue page (`ImportsScreen` wires `onRowOpen` to the router).
 */
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { AppRole, ImportBatch } from "@ecapital/shared";
import { canImportSap } from "@/auth/roles";
import { CostNavTabs, PageTitle } from "@/components/app-shell";
import { Table, type TableColumn } from "@/components/table";
import { formatDate, formatInt } from "@/lib/format";
import type { SapReport } from "@ecapital/shared";
import { UploadCard, type DryRunResult } from "./UploadCard";

export type ImportsScreenState = "default" | "loading" | "empty" | "error" | "noPermission" | "offline";

export interface ImportsProps {
  data?: ImportBatch[];
  state: ImportsScreenState;
  onRetry?: () => void;
  noPermission: ReactNode;
  roles?: AppRole[];
  onRowOpen: (batch: ImportBatch) => void;
  uploadSubmitting?: boolean;
  uploadApiError?: string;
  dryRunResult?: DryRunResult | null;
  onUpload: (file: File, report: SapReport, period: string, dryRun: boolean) => void;
}

export function Imports({
  data,
  state,
  onRetry,
  noPermission,
  roles = [],
  onRowOpen,
  uploadSubmitting,
  uploadApiError,
  dryRunResult,
  onUpload,
}: ImportsProps) {
  const t = useTranslations();

  if (state === "noPermission") return <>{noPermission}</>;

  const columns: TableColumn<ImportBatch>[] = [
    { id: "period", headerKey: "screens.s10.columns.period", accessor: (row) => row.period },
    { id: "report", headerKey: "screens.s10.columns.report", accessor: (row) => row.report ?? "" },
    { id: "file", headerKey: "screens.s10.columns.file", accessor: (row) => row.fileName },
    { id: "rowsIn", headerKey: "screens.s10.columns.rowsIn", accessor: (row) => row.rowsIn, numeric: true, cell: (row) => formatInt(row.rowsIn) },
    { id: "rowsMatched", headerKey: "screens.s10.columns.rowsMatched", accessor: (row) => row.rowsMatched, numeric: true, cell: (row) => formatInt(row.rowsMatched) },
    { id: "rowsUnmatched", headerKey: "screens.s10.columns.rowsUnmatched", accessor: (row) => row.rowsUnmatched, numeric: true, cell: (row) => formatInt(row.rowsUnmatched) },
    {
      id: "status",
      headerKey: "screens.s10.columns.status",
      accessor: (row) => row.status,
      cell: (row) => t(`screens.s10.status.${row.status}`),
    },
    { id: "importedBy", headerKey: "screens.s10.columns.importedBy", accessor: (row) => row.importedByName, cell: (row) => `${row.importedByName} · ${formatDate(row.importedAt)}` },
  ];

  const tableState = state === "loading" ? "loading" : state === "error" ? "error" : state === "empty" ? "empty" : state === "offline" ? "offline" : "default";

  return (
    <>
      <PageTitle eyebrow="" title={t("screens.s10.title")} />
      <CostNavTabs />

      {state === "offline" && <p className="mb-s-4 text-fs-14 text-k-text">{t("states.offline.readOnly")}</p>}

      <UploadCard
        canImport={canImportSap(roles) && state !== "offline"}
        submitting={uploadSubmitting}
        apiError={uploadApiError}
        dryRunResult={dryRunResult}
        onSubmit={onUpload}
      />

      <Table<ImportBatch>
        tableId="s10-imports"
        columns={columns}
        rows={data ?? []}
        getRowId={(row) => row.id}
        captionKey="screens.s10.caption"
        state={tableState}
        onExport={() => undefined}
        onRowOpen={onRowOpen}
        onRetry={onRetry}
        emptyState={{ messageKey: "screens.s10.empty", actionLabelKey: "buttons.exportExcel" }}
      />
    </>
  );
}
