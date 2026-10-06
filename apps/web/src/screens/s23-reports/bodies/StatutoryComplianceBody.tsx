"use client";

// S23a «Νομοθετικοί έλεγχοι» — R39 (CAPEX-01 §11, ADR-0032 §4)
//
/**
 * StatutoryComplianceBody — unit × the four statutory categories, each
 * cell the share done (coloured), «done of due» under it and the overdue
 * count; a totals row adds the counts and recomputes the share.
 *
 * | Prop     | Type                        | Notes                 |
 * |----------|-----------------------------|-----------------------|
 * | report   | StatutoryComplianceReport?  | Absent while loading. |
 * | state    | BodyState                   |                       |
 * | onExport | () => void                  |                       |
 *
 * ASSUMPTION (UI, not in CAPEX-01 or ADR-0032): the colour of the share
 * done — green at 95 % or more, amber at 80 % or more, red below 80 %.
 * No source fixes these thresholds; they are this screen's reading of
 * «compliant / slipping / failing», said on the screen and in the manual,
 * and one constant to change if the head of estates sets others.
 * RULE (contract `StatutoryCell.donePct`): nothing due is null, shown as
 * «Κανένας έλεγχος», never 0 % or 100 %.
 */
import { useTranslations } from "next-intl";
import { StatutoryCategory, type StatutoryComplianceReport, type StatutoryComplianceRow } from "@ecapital/shared";
import { Table, type TableColumn } from "@/components/table";
import { formatInt, formatPct } from "@/lib/format";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.STATUTORY_COMPLIANCE";
const CATEGORIES = StatutoryCategory.options;

/** ASSUMPTION (see the header): green ≥ 95, amber ≥ 80, red below. */
export const DONE_THRESHOLDS = { green: 95, amber: 80 } as const;

export function doneTint(pct: number): "bg-k-green-bg" | "bg-k-amber-bg" | "bg-k-red-bg" {
  if (pct >= DONE_THRESHOLDS.green) return "bg-k-green-bg";
  if (pct >= DONE_THRESHOLDS.amber) return "bg-k-amber-bg";
  return "bg-k-red-bg";
}

interface Counts {
  due: number;
  done: number;
  overdue: number;
  donePct: number | null;
}

function CategoryCell({ cell }: { cell: Counts | undefined }) {
  const t = useTranslations(P);
  if (!cell || cell.due === 0 || cell.donePct === null) return <span className="text-k-text">{t("nothingDue")}</span>;
  return (
    <span className="block">
      <span className={`inline-block rounded-k-chip px-s-1 text-k-ink ${doneTint(cell.donePct)}`}>{formatPct(cell.donePct)}</span>
      <span className="block text-fs-12 text-k-text">{t("doneOf", { done: formatInt(cell.done), due: formatInt(cell.due) })}</span>
      {cell.overdue > 0 && <span className="block text-fs-12 text-k-red">{t("overdue", { count: cell.overdue })}</span>}
    </span>
  );
}

const cellOf = (row: StatutoryComplianceRow, category: StatutoryCategory) => row.cells.find((c) => c.category === category);

export function StatutoryComplianceBody({ report, state, onExport, onRetry }: BodyProps<StatutoryComplianceReport>) {
  const t = useTranslations();
  const rows = report?.rows ?? [];

  const columns: TableColumn<StatutoryComplianceRow>[] = [
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitName },
    ...CATEGORIES.map<TableColumn<StatutoryComplianceRow>>((category) => ({
      id: category,
      headerKey: `statutoryCategory.${category}`,
      accessor: (r) => cellOf(r, category)?.donePct ?? 101,
      numeric: true,
      cell: (r) => <CategoryCell cell={cellOf(r, category)} />,
    })),
  ];

  const total = (category: StatutoryCategory): Counts => {
    const c = rows.reduce(
      (acc, r) => {
        const x = cellOf(r, category);
        return x ? { due: acc.due + x.due, done: acc.done + x.done, overdue: acc.overdue + x.overdue } : acc;
      },
      { due: 0, done: 0, overdue: 0 },
    );
    return { ...c, donePct: c.due === 0 ? null : (c.done / c.due) * 100 };
  };

  return (
    <div className="flex flex-col gap-s-3">
      <Table<StatutoryComplianceRow>
        tableId="s23a-statutory-compliance"
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
          ...Object.fromEntries(CATEGORIES.map((category) => [category, <CategoryCell key={category} cell={total(category)} />])),
        }}
      />
      <p className="text-fs-14 text-k-text">{t(`${P}.thresholds`)}</p>
    </div>
  );
}
