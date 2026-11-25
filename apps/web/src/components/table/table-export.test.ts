import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { fileNameFrom } from "@/data/client";
import { exportKindOf, plainValue, tableExportRequest } from "./table-export";
import type { TableColumn } from "./Table";

/**
 * UAT 25/11/2026 — what the generic export sends: values from the
 * accessors, the kind read off them, and nothing the API would refuse.
 */
interface Row {
  id: string;
  number: number;
  status: "OPEN" | "CLOSED";
  netPayable: number;
  hours: number | null;
  dueDate: string | null;
  contractor: { nameEl: string; id: string } | null;
  tags: string[];
}

const t = (key: string) =>
  ({
    "h.number": "Αριθμός",
    "h.status": "Κατάσταση",
    "h.net": "Καθαρό πληρωτέο",
    "h.hours": "Ώρες",
    "h.due": "Προθεσμία",
    "h.contractor": "Ανάδοχος",
    "h.tags": "Ετικέτες",
    "h.edit": "Επεξεργασία",
    "status.OPEN": "Ανοιχτό",
    "status.CLOSED": "Κλειστό",
    "common.yes": "Ναι",
    "common.no": "Όχι",
  })[key] ?? key;

const rows: Row[] = [
  { id: "a", number: 7, status: "OPEN", netPayable: 1234.56, hours: 2.5, dueDate: "2026-12-01", contractor: { nameEl: "Κατασκευαστική Λτδ", id: "c1" }, tags: ["Α", "Β"] },
  { id: "b", number: 8, status: "CLOSED", netPayable: 100, hours: null, dueDate: null, contractor: null, tags: [] },
];

const columns: TableColumn<Row>[] = [
  { id: "number", headerKey: "h.number", accessor: (r) => r.number, numeric: true },
  { id: "status", headerKey: "h.status", accessor: (r) => r.status, cell: (r) => t(`status.${r.status}`) },
  // A money cell rendered as «1.234,56 €»: the export still sends 1234.56.
  { id: "net", headerKey: "h.net", accessor: (r) => r.netPayable, numeric: true, cell: (r) => `${r.netPayable} €` },
  { id: "hours", headerKey: "h.hours", accessor: (r) => r.hours, numeric: true, cell: (r) => (r.hours === null ? "—" : String(r.hours)) },
  { id: "dueDate", headerKey: "h.due", accessor: (r) => r.dueDate ?? "", numeric: true },
  { id: "contractor", headerKey: "h.contractor", accessor: (r) => r.contractor, cell: (r) => createElement("span", null, r.contractor?.nameEl) },
  { id: "tags", headerKey: "h.tags", accessor: (r) => r.tags },
  { id: "edit", headerKey: "h.edit", accessor: () => "", cell: () => createElement("button", null, "Επεξεργασία") },
];

describe("tableExportRequest", () => {
  it("sends translated headers, kinds read off the values, and accessor values", () => {
    const request = tableExportRequest({ title: "Πιστοποιήσεις", columns, rows, t, source: "/x" });
    expect(request).toMatchObject({ title: "Πιστοποιήσεις", sheetName: "Πιστοποιήσεις", source: "/x" });
    expect(request.columns).toEqual([
      { header: "Αριθμός", numeric: true, kind: "text" },
      { header: "Κατάσταση", numeric: false, kind: "text" },
      { header: "Καθαρό πληρωτέο", numeric: true, kind: "money" },
      { header: "Ώρες", numeric: true, kind: "number" },
      { header: "Προθεσμία", numeric: true, kind: "date" },
      { header: "Ανάδοχος", numeric: false, kind: "text" },
      { header: "Ετικέτες", numeric: false, kind: "text" },
    ]);
    expect(request.rows).toEqual([
      [7, "Ανοιχτό", 1234.56, 2.5, "2026-12-01", "Κατασκευαστική Λτδ", "Α, Β"],
      [8, "Κλειστό", 100, null, null, null, null],
    ]);
  });

  it("follows the column's own exportKind, and leaves out a column marked none", () => {
    const own: TableColumn<Row>[] = [
      { id: "hours", headerKey: "h.hours", accessor: (r) => r.hours, exportKind: "money" },
      { id: "status", headerKey: "h.status", accessor: (r) => r.status, exportKind: "none" },
    ];
    const request = tableExportRequest({ title: "x", columns: own, rows, t });
    expect(request.columns).toEqual([{ header: "Ώρες", numeric: false, kind: "money" }]);
    expect(request.rows).toEqual([[2.5], [null]]);
  });

  it("reads a money column by its id when the cell is markup", () => {
    const column: TableColumn<Row> = {
      id: "approvedBudget",
      headerKey: "h.net",
      accessor: (r) => r.netPayable,
      numeric: true,
      cell: (r) => createElement("span", null, r.netPayable),
    };
    expect(exportKindOf(column, rows)).toBe("money");
  });
});

describe("plainValue", () => {
  it("turns what an accessor returns into something Excel can hold", () => {
    expect(plainValue(true, t)).toBe("Ναι");
    expect(plainValue(Number.NaN, t)).toBeNull();
    expect(plainValue("  —  ", t)).toBeNull();
    expect(plainValue({ code: "PRJ-1" }, t)).toBe("PRJ-1");
    expect(plainValue({ a: 1 }, t)).toBe('{"a":1}');
    expect(plainValue(new Date("2026-11-25T00:00:00Z"), t)).toBe("2026-11-25T00:00:00.000Z");
    expect(String(plainValue("x".repeat(5000), t)).length).toBe(2000);
  });
});

describe("fileNameFrom", () => {
  it("prefers the UTF-8 name, then the plain one, then the fallback", () => {
    expect(fileNameFrom(`attachment; filename="a.xlsx"; filename*=UTF-8''%CE%88%CF%81%CE%B3%CE%B1.xlsx`, "f")).toBe("Έργα.xlsx");
    expect(fileNameFrom('attachment; filename="a.xlsx"', "f")).toBe("a.xlsx");
    expect(fileNameFrom(null, "f")).toBe("f");
  });
});
