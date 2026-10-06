"use client";

// S23a «Εκκρεμότητες συντήρησης ανά κατηγορία κινδύνου» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * BacklogByBandBody — unit × the four risk bands, each cell the count and
 * the estimate with its funded / unfunded split under it, then the unit's
 * total, funded and unfunded columns, and a totals row.
 *
 * | Prop     | Type                  | Notes                 |
 * |----------|-----------------------|-----------------------|
 * | report   | BacklogByBandReport?  | Absent while loading. |
 * | state    | BodyState             |                       |
 * | onExport | () => void            |                       |
 *
 * RULE (contract): the same figures as S21's summary, in RISK_BAND_ORDER.
 * RULE (UI instructions §4, S21): a band carries S21's tint and always its
 * name in the header, so the colour is never the only signal.
 */
import { useTranslations } from "next-intl";
import { RISK_BAND_ORDER, type BacklogByBandReport, type BacklogByBandRow, type RiskBand } from "@ecapital/shared";
import { Table, type TableColumn } from "@/components/table";
import { formatEUR } from "@/lib/format";
import { BAND_TINT } from "@/screens/s21-backlog/BacklogSummary";
import { DASH } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.BACKLOG_BY_BAND";

interface Cell {
  count: number;
  costEstimate: number;
  fundedCost: number;
  unfundedCost: number;
}

function BandCell({ band, cell }: { band: RiskBand; cell: Cell | undefined }) {
  const t = useTranslations(P);
  if (!cell || cell.count === 0) return <>{DASH}</>;
  return (
    <span className="block">
      <span className={`inline-block whitespace-nowrap rounded-k-chip px-s-1 text-k-ink ${BAND_TINT[band]}`}>
        {t("items", { count: cell.count })} · {formatEUR(cell.costEstimate)}
      </span>
      <span className="block text-fs-12 text-k-text">{t("split", { funded: formatEUR(cell.fundedCost), unfunded: formatEUR(cell.unfundedCost) })}</span>
    </span>
  );
}

const bandOf = (row: BacklogByBandRow, band: RiskBand) => row.bands.find((b) => b.riskBand === band);

export function BacklogByBandBody({ report, state, onExport, onRetry }: BodyProps<BacklogByBandReport>) {
  const t = useTranslations();
  const rows = report?.rows ?? [];

  const columns: TableColumn<BacklogByBandRow>[] = [
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitName },
    ...RISK_BAND_ORDER.map<TableColumn<BacklogByBandRow>>((band) => ({
      id: band,
      headerKey: `riskBands.${band}`,
      accessor: (r) => bandOf(r, band)?.costEstimate ?? 0,
      numeric: true,
      cell: (r) => <BandCell band={band} cell={bandOf(r, band)} />,
    })),
    { id: "total", headerKey: `${P}.columns.total`, accessor: (r) => r.total, numeric: true, cell: (r) => formatEUR(r.total) },
    { id: "funded", headerKey: `${P}.columns.funded`, accessor: (r) => r.funded, numeric: true, cell: (r) => formatEUR(r.funded) },
    { id: "unfunded", headerKey: `${P}.columns.unfunded`, accessor: (r) => r.unfunded, numeric: true, cell: (r) => formatEUR(r.unfunded) },
  ];

  const sumBand = (band: RiskBand): Cell =>
    rows.reduce<Cell>(
      (acc, r) => {
        const c = bandOf(r, band);
        return c
          ? { count: acc.count + c.count, costEstimate: acc.costEstimate + c.costEstimate, fundedCost: acc.fundedCost + c.fundedCost, unfundedCost: acc.unfundedCost + c.unfundedCost }
          : acc;
      },
      { count: 0, costEstimate: 0, fundedCost: 0, unfundedCost: 0 },
    );

  return (
    <Table<BacklogByBandRow>
      tableId="s23a-backlog-by-band"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.orgUnitId}
      captionKey={`${P}.caption`}
      state={tableState(state, rows.length)}
      density="comfortable"
      onExport={onExport}
      onRetry={onRetry}
      emptyState={EMPTY}
      totals={{
        unit: t("screens.s23a.total"),
        ...Object.fromEntries(RISK_BAND_ORDER.map((band) => [band, <BandCell key={band} band={band} cell={sumBand(band)} />])),
        total: formatEUR(rows.reduce((s, r) => s + r.total, 0)),
        funded: formatEUR(rows.reduce((s, r) => s + r.funded, 0)),
        unfunded: formatEUR(rows.reduce((s, r) => s + r.unfunded, 0)),
      }}
    />
  );
}
