"use client";

// S23a «Κύκλος ζωής παγίων» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * AssetLifecycleBody — one row per asset with a capital cost or a
 * replacement year: what it cost, what it has cost to keep running, how
 * long it was down, how much life is left and when it is replaced.
 *
 * | Prop     | Type                   | Notes                 |
 * |----------|------------------------|-----------------------|
 * | report   | AssetLifecycleReport?  | Absent while loading. |
 * | state    | BodyState              |                       |
 * | onExport | () => void             |                       |
 *
 * RULE (build brief): the default order is remaining life ascending — the
 * asset nearest the end first, a life already past (negative) before any
 * still left, and an asset without the inputs (null) last.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Condition, type AssetLifecycleReport, type AssetLifecycleRow } from "@ecapital/shared";
import { ConditionChip } from "@/components/condition-chip";
import { CriticalityChip, type CriticalityValue } from "@/components/criticality-chip";
import { Table, type TableColumn } from "@/components/table";
import { formatDecimal, formatInt } from "@/lib/format";
import { DASH, eurOrDash, pctOrDash } from "../cells";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.ASSET_LIFECYCLE";

export function sortByRemainingLife(rows: AssetLifecycleRow[]): AssetLifecycleRow[] {
  return [...rows].sort((a, b) => {
    if (a.remainingLifeYears === b.remainingLifeYears) return a.tag.localeCompare(b.tag);
    if (a.remainingLifeYears === null) return 1;
    if (b.remainingLifeYears === null) return -1;
    return a.remainingLifeYears - b.remainingLifeYears;
  });
}

function criticality(value: number): CriticalityValue {
  return Math.min(5, Math.max(1, Math.round(value))) as CriticalityValue;
}

export function AssetLifecycleBody({ report, state, onExport, onRetry }: BodyProps<AssetLifecycleReport>) {
  const t = useTranslations();
  const rows = useMemo(() => sortByRemainingLife(report?.rows ?? []), [report]);
  const intOrDash = (v: number | null) => (v === null ? DASH : String(v));

  const columns: TableColumn<AssetLifecycleRow>[] = [
    {
      id: "tag",
      headerKey: `${P}.columns.tag`,
      accessor: (r) => r.tag,
      cell: (r) => (
        <Link href={`/assets/${encodeURIComponent(r.assetId)}`} className="whitespace-nowrap font-k-mono text-k-blue underline-offset-2 hover:underline">
          {r.tag}
        </Link>
      ),
    },
    { id: "name", headerKey: `${P}.columns.name`, accessor: (r) => r.nameEl },
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitName },
    {
      id: "assetClass",
      headerKey: `${P}.columns.assetClass`,
      accessor: (r) => r.assetClass,
      cell: (r) => (t.has(`assetClass.${r.assetClass}`) ? t(`assetClass.${r.assetClass}`) : r.assetClass),
    },
    { id: "criticality", headerKey: `${P}.columns.criticality`, accessor: (r) => r.criticality, cell: (r) => <CriticalityChip value={criticality(r.criticality)} /> },
    {
      id: "condition",
      headerKey: `${P}.columns.condition`,
      accessor: (r) => r.condition ?? "Z",
      cell: (r) => {
        const parsed = Condition.safeParse(r.condition);
        return parsed.success ? <ConditionChip value={parsed.data} /> : DASH;
      },
    },
    { id: "installed", headerKey: `${P}.columns.installed`, accessor: (r) => r.installedYear ?? 0, numeric: true, cell: (r) => intOrDash(r.installedYear) },
    { id: "capitalCost", headerKey: `${P}.columns.capitalCost`, accessor: (r) => r.capitalCost ?? -1, numeric: true, cell: (r) => eurOrDash(r.capitalCost) },
    { id: "maintenanceCost", headerKey: `${P}.columns.maintenanceCost`, accessor: (r) => r.maintenanceCost, numeric: true, cell: (r) => eurOrDash(r.maintenanceCost) },
    {
      id: "maintenancePct",
      headerKey: `${P}.columns.maintenancePct`,
      accessor: (r) => r.maintenanceToCapitalPct ?? -1,
      numeric: true,
      cell: (r) => pctOrDash(r.maintenanceToCapitalPct),
    },
    { id: "corrective", headerKey: `${P}.columns.corrective`, accessor: (r) => r.correctiveOrders, numeric: true, cell: (r) => formatInt(r.correctiveOrders) },
    { id: "downtime", headerKey: `${P}.columns.downtime`, accessor: (r) => r.downtimeHours, numeric: true, cell: (r) => formatDecimal(r.downtimeHours) },
    {
      id: "remainingLife",
      headerKey: `${P}.columns.remainingLife`,
      accessor: (r) => r.remainingLifeYears ?? Number.POSITIVE_INFINITY,
      numeric: true,
      // RULE: a life already past reads in red; the figure is still printed, never hidden behind the colour.
      cell: (r) =>
        r.remainingLifeYears === null ? DASH : <span className={r.remainingLifeYears < 0 ? "text-k-red" : undefined}>{t(`${P}.years`, { count: r.remainingLifeYears })}</span>,
    },
    { id: "replacementYear", headerKey: `${P}.columns.replacementYear`, accessor: (r) => r.replacementYear ?? 0, numeric: true, cell: (r) => intOrDash(r.replacementYear) },
    {
      id: "replacementCost",
      headerKey: `${P}.columns.replacementCost`,
      accessor: (r) => r.replacementCostEst ?? -1,
      numeric: true,
      cell: (r) => eurOrDash(r.replacementCostEst),
    },
  ];

  return (
    <Table<AssetLifecycleRow>
      tableId="s23a-asset-lifecycle"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.assetId}
      captionKey={`${P}.caption`}
      state={tableState(state, rows.length)}
      onExport={onExport}
      onRetry={onRetry}
      emptyState={EMPTY}
    />
  );
}
