"use client";

// Sample data and handlers for the preview gallery (ADR-0004). This lives in
// its own client module because the gallery page is a Server Component and
// cannot hand function props — accessors, cell renderers, callbacks — to a
// Client Component. The figures are fake round numbers for a fake project.

import { useState } from "react";
import { formatEUR } from "@/lib/format";
import { Table, type TableColumn, type TableState } from "./Table";

interface CostRow {
  id: string;
  category: string;
  approved: number;
  committed: number;
  spent: number;
  forecast: number;
}

const rows: CostRow[] = [
  { id: "c1", category: "Μελέτες και επίβλεψη", approved: 180_000, committed: 175_000, spent: 162_000, forecast: 178_000 },
  { id: "c2", category: "Οικοδομικές εργασίες", approved: 1_200_000, committed: 1_150_000, spent: 640_000, forecast: 1_260_000 },
  { id: "c3", category: "Ηλεκτρομηχανολογικές εγκαταστάσεις", approved: 760_000, committed: 705_000, spent: 388_000, forecast: 790_000 },
  { id: "c4", category: "Ιατροτεχνολογικός εξοπλισμός", approved: 220_000, committed: 120_000, spent: 84_000, forecast: 240_000 },
  { id: "c5", category: "Απρόβλεπτα", approved: 40_000, committed: 0, spent: 0, forecast: 20_000 },
];

const money = (value: number) => formatEUR(value);

const columns: Array<TableColumn<CostRow>> = [
  { id: "category", headerKey: "components.table.sample.category", accessor: (row) => row.category },
  {
    id: "approved",
    headerKey: "components.costBar.approved",
    accessor: (row) => row.approved,
    cell: (row) => money(row.approved),
    numeric: true,
  },
  {
    id: "committed",
    headerKey: "components.costBar.committed",
    accessor: (row) => row.committed,
    cell: (row) => money(row.committed),
    numeric: true,
  },
  {
    id: "spent",
    headerKey: "components.costBar.spent",
    accessor: (row) => row.spent,
    cell: (row) => money(row.spent),
    numeric: true,
  },
  {
    id: "forecast",
    headerKey: "components.costBar.forecast",
    accessor: (row) => row.forecast,
    cell: (row) => money(row.forecast),
    numeric: true,
    editable: true,
  },
];

export function TableDemo({ state }: { state: TableState }) {
  const [data, setData] = useState(rows);

  return (
    <Table<CostRow>
      tableId={`preview-${state}`}
      columns={columns}
      rows={data}
      getRowId={(row) => row.id}
      captionKey="components.table.sample.caption"
      state={state}
      selectable
      emptyState={{
        messageKey: "components.table.sample.emptyMessage",
        actionLabelKey: "buttons.add",
        onAction: () => undefined,
      }}
      onExport={() => undefined}
      onRowOpen={() => undefined}
      onSelectionChange={() => undefined}
      onRetry={() => undefined}
      onCellEdit={(row, columnId, value) => {
        const parsed = Number(value.replace(/[^\d-]/g, ""));
        if (columnId !== "forecast" || Number.isNaN(parsed)) return;
        setData((current) =>
          current.map((item) => (item.id === row.id ? { ...item, forecast: parsed } : item)),
        );
      }}
    />
  );
}
