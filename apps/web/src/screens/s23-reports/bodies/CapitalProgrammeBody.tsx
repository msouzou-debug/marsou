"use client";

// S23a «Πρόγραμμα έργων ανά μονάδα» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * CapitalProgrammeBody — one row per unit with approved, Δεσμεύσεις,
 * Δαπάνες, forecast, slippage, spent % against the year elapsed and the RAG
 * counts; a KpiTile row and a totals row over it.
 *
 * | Prop     | Type                     | Notes                                     |
 * |----------|--------------------------|-------------------------------------------|
 * | report   | CapitalProgrammeReport?  | Absent while loading.                     |
 * | state    | BodyState                |                                           |
 * | onExport | () => void               | The table's own export button.            |
 *
 * RULE (contract `CapitalProgrammeRow`): the totals row is computed here
 * and by a formula in the export, never sent; a ledger with no source is
 * null, shown as «—», and left out of the sum the way Excel's SUM skips a
 * blank cell.
 */
import { useLocale, useTranslations } from "next-intl";
import type { CapitalProgrammeReport, CapitalProgrammeRow } from "@ecapital/shared";
import type { Locale } from "@/i18n/config";
import { KpiTile } from "@/components/kpi-tile";
import { RagChip } from "@/components/rag-chip";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR, formatInt, formatPct } from "@/lib/format";
import { DASH, Slippage, Stacked, eurOrDash, pctOrDash, sumKnown } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.CAPITAL_PROGRAMME";

/** The totals row: SUM over the rows, a ledger with no source left out (Excel's SUM over a blank). */
export function capitalTotals(rows: CapitalProgrammeRow[]) {
  const approved = rows.reduce((s, r) => s + r.approved, 0);
  const spent = sumKnown(rows.map((r) => r.spent));
  return {
    projects: rows.reduce((s, r) => s + r.projectCount, 0),
    approved,
    committed: sumKnown(rows.map((r) => r.committed)),
    spent,
    forecast: sumKnown(rows.map((r) => r.forecast)),
    slippage: sumKnown(rows.map((r) => r.slippage)),
    spentPct: spent === null || approved === 0 ? null : (spent / approved) * 100,
    rag: {
      green: rows.reduce((s, r) => s + r.rag.green, 0),
      amber: rows.reduce((s, r) => s + r.rag.amber, 0),
      red: rows.reduce((s, r) => s + r.rag.red, 0),
    },
  };
}

export function CapitalProgrammeBody({ report, state, onExport, onRetry }: BodyProps<CapitalProgrammeReport>) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const rows = report?.rows ?? [];
  const yearPct = report ? formatPct(report.yearElapsedPct) : "";

  const totals = capitalTotals(rows);

  const ragChips = (rag: CapitalProgrammeRow["rag"]) => (
    <span className="flex items-center gap-s-1">
      <RagChip value="green" variant="count" count={rag.green} />
      <RagChip value="amber" variant="count" count={rag.amber} />
      <RagChip value="red" variant="count" count={rag.red} />
    </span>
  );
  const spentCell = (pct: number | null) => <Stacked top={pctOrDash(pct)} bottom={report ? t(`${P}.yearShare`, { pct: yearPct }) : undefined} />;

  const columns: TableColumn<CapitalProgrammeRow>[] = [
    {
      id: "unit",
      headerKey: "common.unit",
      accessor: (r) => (locale === "en" ? r.orgUnit.nameEn : r.orgUnit.nameEl),
    },
    { id: "projects", headerKey: `${P}.columns.projects`, accessor: (r) => r.projectCount, numeric: true, cell: (r) => formatInt(r.projectCount) },
    { id: "approved", headerKey: `${P}.columns.approved`, accessor: (r) => r.approved, numeric: true, cell: (r) => formatEUR(r.approved) },
    { id: "committed", headerKey: `${P}.columns.committed`, accessor: (r) => r.committed ?? -Infinity, numeric: true, cell: (r) => eurOrDash(r.committed) },
    { id: "spent", headerKey: `${P}.columns.spent`, accessor: (r) => r.spent ?? -Infinity, numeric: true, cell: (r) => eurOrDash(r.spent) },
    { id: "forecast", headerKey: `${P}.columns.forecast`, accessor: (r) => r.forecast ?? -Infinity, numeric: true, cell: (r) => eurOrDash(r.forecast) },
    { id: "slippage", headerKey: `${P}.columns.slippage`, accessor: (r) => r.slippage ?? -Infinity, numeric: true, cell: (r) => <Slippage value={r.slippage} /> },
    { id: "spentPct", headerKey: `${P}.columns.spentPct`, accessor: (r) => r.spentPct ?? -1, numeric: true, cell: (r) => spentCell(r.spentPct) },
    { id: "rag", headerKey: `${P}.columns.rag`, accessor: (r) => r.rag.red * 10000 + r.rag.amber, cell: (r) => ragChips(r.rag) },
  ];

  const tileState = state === "loading" ? "loading" : state === "error" ? "error" : "default";
  const kpi = (key: string) => t(`${P}.kpi.${key}`);
  const ready = report !== undefined && rows.length > 0;

  return (
    <div className="flex flex-col gap-s-5">
      {(state === "loading" || ready) && (
        <div className="grid grid-cols-2 gap-s-4 tablet:grid-cols-3 print:grid-cols-3">
          <KpiTile label={kpi("approved")} value={ready ? formatEUR(totals.approved) : ""} state={tileState} onRetry={onRetry} />
          <KpiTile label={kpi("committed")} value={ready ? eurOrDash(totals.committed) : ""} state={tileState} onRetry={onRetry} />
          <KpiTile
            label={kpi("spent")}
            value={ready ? eurOrDash(totals.spent) : ""}
            comparator={ready && totals.spentPct !== null ? t(`${P}.kpi.spentShare`, { pct: formatPct(totals.spentPct) }) : undefined}
            state={tileState}
            onRetry={onRetry}
          />
          <KpiTile label={kpi("forecast")} value={ready ? eurOrDash(totals.forecast) : ""} state={tileState} onRetry={onRetry} />
          <KpiTile
            label={kpi("slippage")}
            value={ready ? (totals.slippage === null ? DASH : `${totals.slippage > 0 ? "+" : ""}${formatEUR(totals.slippage)}`) : ""}
            state={tileState}
            onRetry={onRetry}
          />
          <KpiTile label={kpi("yearElapsed")} value={ready ? yearPct : ""} state={tileState} onRetry={onRetry} />
        </div>
      )}
      <Table<CapitalProgrammeRow>
        tableId="s23a-capital-programme"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.orgUnit.id}
        captionKey={`${P}.caption`}
        state={tableState(state, rows.length)}
        density="comfortable"
        onExport={onExport}
        onRetry={onRetry}
        emptyState={EMPTY}
        totals={{
          unit: t("screens.s23a.total"),
          projects: formatInt(totals.projects),
          approved: formatEUR(totals.approved),
          committed: eurOrDash(totals.committed),
          spent: eurOrDash(totals.spent),
          forecast: eurOrDash(totals.forecast),
          slippage: <Slippage value={totals.slippage} />,
          spentPct: spentCell(totals.spentPct),
          rag: ragChips(totals.rag),
        }}
      />
      {ready && <p className="text-fs-14 text-k-text">{t(`${P}.slippageNote`)}</p>}
    </div>
  );
}
