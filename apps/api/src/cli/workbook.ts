/**
 * Reading the capex plan workbook, one cell at a time, keeping the cell's
 * type.
 *
 * R41, CAPEX-03 §2: "Three rows in columns AG and W hold text where a number
 * belongs. They are string-typed cells, so the importer must reject them
 * rather than coerce to zero." That sentence is why this module exists: a
 * reader that hands back `0` for «περίπου 1,2 εκ.» loses the only signal that
 * the figure was never entered, and the reconciliation report then ties
 * perfectly to a file that is wrong.
 *
 * Why exceljs and not SheetJS: see ADR-0016. In one line — exceljs keeps the
 * cell type, and the only SheetJS build on the npm registry is the abandoned
 * 0.18.5 with open advisories against it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { columnLetter } from "./profile";

export type CellKind = "empty" | "number" | "text" | "date" | "boolean" | "error";

export interface Cell {
  kind: CellKind;
  /** Set when kind is "number". */
  number: number | null;
  /** Set when kind is "text" (and for anything else, its printable form). */
  text: string | null;
  /** ISO date, set when kind is "date". */
  date: string | null;
  /** What the cell looks like in a report, whatever its type. */
  raw: string;
  /** The formula the value came from, where it came from one. */
  formula: string | null;
}

export const EMPTY_CELL: Cell = {
  kind: "empty",
  number: null,
  text: null,
  date: null,
  raw: "",
  formula: null,
};

export interface SheetRow {
  /** The spreadsheet's own row number, so a report line can be found again. */
  rowNo: number;
  cells: Map<string, Cell>;
}

export interface LoadedWorkbook {
  filePath: string;
  fileName: string;
  sha256: string;
  sheetNames: string[];
  sheetName: string;
  /** The widest column any row in the sheet uses. */
  lastColumn: number;
  row(rowNo: number): SheetRow;
  lastRow: number;
}

export function sha256Of(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function cellFrom(value: ExcelJS.CellValue): Cell {
  if (value === null || value === undefined) return EMPTY_CELL;

  if (typeof value === "object" && "formula" in value) {
    // A formula cell carries the value Excel last calculated. The capex plan
    // is full of them (CAPEX-03 §6 counts three that are wrong), and the
    // cached result is what a reader of the file sees.
    const inner = cellFrom((value as ExcelJS.CellFormulaValue).result ?? null);
    return { ...inner, formula: (value as ExcelJS.CellFormulaValue).formula };
  }
  if (typeof value === "object" && "richText" in value) {
    const text = (value as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    return textCell(text);
  }
  if (typeof value === "object" && "error" in value) {
    const raw = String((value as ExcelJS.CellErrorValue).error);
    return { kind: "error", number: null, text: raw, date: null, raw, formula: null };
  }
  if (typeof value === "object" && "text" in value) {
    return textCell(String((value as ExcelJS.CellHyperlinkValue).text));
  }
  if (value instanceof Date) {
    const iso = value.toISOString().slice(0, 10);
    return { kind: "date", number: null, text: null, date: iso, raw: iso, formula: null };
  }
  if (typeof value === "number") {
    return {
      kind: "number",
      number: value,
      text: null,
      date: null,
      raw: String(value),
      formula: null,
    };
  }
  if (typeof value === "boolean") {
    const raw = value ? "TRUE" : "FALSE";
    return { kind: "boolean", number: null, text: raw, date: null, raw, formula: null };
  }
  return textCell(String(value));
}

function textCell(value: string): Cell {
  const trimmed = value.trim();
  if (trimmed === "") return EMPTY_CELL;
  return { kind: "text", number: null, text: trimmed, date: null, raw: trimmed, formula: null };
}

export async function loadWorkbook(filePath: string, sheetName: string): Promise<LoadedWorkbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheetNames = workbook.worksheets.map((w) => w.name);
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    throw new Error(
      `The workbook has no sheet called «${sheetName}». It has: ${sheetNames.join(", ")}`,
    );
  }

  let lastColumn = sheet.actualColumnCount || sheet.columnCount || 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    lastColumn = Math.max(lastColumn, row.actualCellCount || 0, row.cellCount || 0);
  });

  const cache = new Map<number, SheetRow>();
  const readRow = (rowNo: number): SheetRow => {
    const cached = cache.get(rowNo);
    if (cached) return cached;
    const row = sheet.getRow(rowNo);
    const cells = new Map<string, Cell>();
    for (let index = 1; index <= lastColumn; index += 1) {
      cells.set(columnLetter(index), cellFrom(row.getCell(index).value));
    }
    const result = { rowNo, cells };
    cache.set(rowNo, result);
    return result;
  };

  return {
    filePath,
    fileName: filePath.split("/").pop() ?? filePath,
    sha256: sha256Of(filePath),
    sheetNames,
    sheetName: sheet.name,
    lastColumn,
    lastRow: sheet.rowCount,
    row: readRow,
  };
}

/** The header row of a loaded sheet, column letter → text. */
export function headerOf(workbook: LoadedWorkbook, headerRow: number): Map<string, string> {
  const row = workbook.row(headerRow);
  const header = new Map<string, string>();
  for (const [letter, cell] of row.cells) header.set(letter, cell.raw);
  return header;
}

export function cellOf(row: SheetRow, letter: string): Cell {
  return row.cells.get(letter) ?? EMPTY_CELL;
}
