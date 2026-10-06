"use client";

// S23a «Διαταράξεις κλινικής λειτουργίας» — R39 (CAPEX-01 §11, ADR-0032)
//
/**
 * ClinicalDisruptionBody — unit rows × twelve months, each cell the theatre
 * hours over the ICU hours lost to planned works, then the year's totals
 * per unit and a totals row per month. Prints landscape (`catalogue.ts`).
 *
 * | Prop     | Type                       | Notes                 |
 * |----------|----------------------------|-----------------------|
 * | report   | ClinicalDisruptionReport?  | Absent while loading. |
 * | state    | BodyState                  |                       |
 * | onExport | () => void                 |                       |
 *
 * NO PATIENT DATA: hours and permits per unit and month, nothing else.
 */
import { useTranslations } from "next-intl";
import type { ClinicalDisruptionReport, ClinicalDisruptionRow } from "@ecapital/shared";
import { Table, type TableColumn } from "@/components/table";
import { formatDecimal, formatInt } from "@/lib/format";
import { EMPTY, tableState, type BodyProps } from "./types";

const P = "screens.s23a.reports.CLINICAL_DISRUPTION";
const MONTH_IDS = ["m01", "m02", "m03", "m04", "m05", "m06", "m07", "m08", "m09", "m10", "m11", "m12"] as const;

function Hours({ theatre, icu }: { theatre: number; icu: number }) {
  const t = useTranslations(P);
  return (
    <span className="block">
      <span className="block" aria-label={`${t("theatre")} ${formatDecimal(theatre)}`}>
        {formatDecimal(theatre)}
      </span>
      <span className="block text-fs-12 text-k-text" aria-label={`${t("icu")} ${formatDecimal(icu)}`}>
        {formatDecimal(icu)}
      </span>
    </span>
  );
}

export function ClinicalDisruptionBody({ report, state, onExport, onRetry }: BodyProps<ClinicalDisruptionReport>) {
  const t = useTranslations();
  const rows = report?.rows ?? [];

  const columns: TableColumn<ClinicalDisruptionRow>[] = [
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitName },
    ...MONTH_IDS.map<TableColumn<ClinicalDisruptionRow>>((id, i) => ({
      id,
      headerKey: `${P}.months.${id}`,
      accessor: (r) => r.months[i].theatreHours + r.months[i].icuHours,
      numeric: true,
      cell: (r) => <Hours theatre={r.months[i].theatreHours} icu={r.months[i].icuHours} />,
    })),
    { id: "theatreTotal", headerKey: `${P}.columns.theatreTotal`, accessor: (r) => r.theatreHoursTotal, numeric: true, cell: (r) => formatDecimal(r.theatreHoursTotal) },
    { id: "icuTotal", headerKey: `${P}.columns.icuTotal`, accessor: (r) => r.icuHoursTotal, numeric: true, cell: (r) => formatDecimal(r.icuHoursTotal) },
    { id: "permits", headerKey: `${P}.columns.permits`, accessor: (r) => r.permitsTotal, numeric: true, cell: (r) => formatInt(r.permitsTotal) },
  ];

  const sum = (get: (r: ClinicalDisruptionRow) => number) => rows.reduce((s, r) => s + get(r), 0);

  return (
    <div className="flex flex-col gap-s-3">
      <p className="text-fs-14 text-k-text">{t(`${P}.legend`)}</p>
      <Table<ClinicalDisruptionRow>
        tableId="s23a-clinical-disruption"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.orgUnitId}
        captionKey={`${P}.caption`}
        state={tableState(state, rows.length)}
        onExport={onExport}
        onRetry={onRetry}
        emptyState={EMPTY}
        totals={{
          unit: t("screens.s23a.total"),
          ...Object.fromEntries(
            MONTH_IDS.map((id, i) => [id, <Hours key={id} theatre={sum((r) => r.months[i].theatreHours)} icu={sum((r) => r.months[i].icuHours)} />]),
          ),
          theatreTotal: formatDecimal(sum((r) => r.theatreHoursTotal)),
          icuTotal: formatDecimal(sum((r) => r.icuHoursTotal)),
          permits: formatInt(sum((r) => r.permitsTotal)),
        }}
      />
    </div>
  );
}
