"use client";

// S15 — R25, build brief §11 "Clinical disruption: theatre and ICU hours
// lost to planned works, by hospital and month".
//
/**
 * DisruptionHoursTable — the small table above the calendar grid: theatre
 * and ICU hours by unit and month, for the year, exportable (UI instructions
 * §5 item 7 "no pie charts").
 *
 * | Prop  | Type                 | Notes                                          |
 * |-------|----------------------|---------------------------------------------------|
 * | rows  | DisruptionHoursRow[] |                                                    |
 * | state | TableState           | Reuses `Table`'s own five-state vocabulary.         |
 */
import type { DisruptionHoursRow } from "@ecapital/shared";
import { Table, type TableColumn, type TableState } from "@/components/table";

export interface DisruptionHoursTableProps {
  rows: DisruptionHoursRow[];
  state: TableState;
  onExport?: () => void;
}

export function DisruptionHoursTable({ rows, state, onExport }: DisruptionHoursTableProps) {
  const columns: TableColumn<DisruptionHoursRow>[] = [
    { id: "unit", headerKey: "common.unit", accessor: (r) => r.orgUnitNameEl },
    { id: "month", headerKey: "screens.s15.hours.month", accessor: (r) => r.month, numeric: true },
    { id: "theatre", headerKey: "screens.s15.hours.theatre", accessor: (r) => r.theatreHours, numeric: true },
    { id: "icu", headerKey: "screens.s15.hours.icu", accessor: (r) => r.icuHours, numeric: true },
    { id: "permits", headerKey: "screens.s15.hours.permits", accessor: (r) => r.permits, numeric: true },
  ];

  return (
    <Table<DisruptionHoursRow>
      tableId="s15-disruption-hours"
      columns={columns}
      rows={rows}
      getRowId={(r) => `${r.orgUnitId}-${r.month}`}
      captionKey="screens.s15.hours.caption"
      state={state}
      density="dense"
      onExport={onExport}
      emptyState={{ messageKey: "screens.s15.hours.empty", actionLabelKey: "buttons.add", onAction: undefined }}
    />
  );
}
