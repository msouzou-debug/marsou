/**
 * The generic table export (UAT 25/11/2026): any screen's `Table` without a
 * purpose-built export sends the columns and rows it shows, and this turns
 * them into a workbook.
 *
 * RULE (owner: «the Excel must be live, dynamic and auditable», the same rule
 * cost-export.ts, maintenance-export.ts and reports-export.ts live by):
 *   - the values are values — a figure is a number, a date is a real Excel
 *     date (dd/mm/yyyy), never the screen's «1.234 €» or «24/11/2026» text;
 *   - every total is a live formula, `SUBTOTAL(9,…)` over the column, so it
 *     follows the autofilter: filter the rows and the total is the total of
 *     what is left, never a pasted answer;
 *   - header row bold and frozen, autofilter over the header and the rows
 *     (not the totals row, which must never be filtered away);
 *   - money `#,##0.00 "€"`, which Excel shows in the reader's own separators
 *     (1.234,56 € on a Greek machine);
 *   - a second sheet says where the rows came from and when: the screen,
 *     its path, the moment of export (Europe/Nicosia) and the row count as a
 *     formula over the data range.
 * A blank on the screen («—») is a blank cell, never 0 (CAPEX-01 §7).
 *
 * The caps are in `@ecapital/shared` (`TABLE_EXPORT_MAX_*`) and the body
 * size in `TABLE_EXPORT_BODY_LIMIT` below; both bound what one request can
 * ask for.
 */
import ExcelJS from "exceljs";
import type { TableExportCell, TableExportColumn, TableExportRequest } from "@ecapital/shared";
import type { I18nService, Locale } from "../common/i18n.service";

/** The JSON body limit for `POST /exports/table` only; below the web proxy's 10 MB buffer. */
export const TABLE_EXPORT_BODY_LIMIT = "8mb";

export const MONEY_FORMAT = '#,##0.00 "€"';
/** ADR-0038: a VAT rate held as a fraction, shown «19%». */
export const PERCENT_FORMAT = "0%";
export const DATE_FORMAT = "dd/mm/yyyy";
const DATE_TIME_FORMAT = "dd/mm/yyyy hh:mm";
const INTEGER_FORMAT = "#,##0";
const DECIMAL_FORMAT = "#,##0.00";
const HEADER_FILL = "FFEFEFEF";
const TIME_ZONE = "Europe/Nicosia";

/** `1` → `A`, `27` → `AA`. */
function columnLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Excel: at most 31 characters, none of `[]:*?/\`, not blank, no leading or trailing apostrophe. */
export function sheetNameOf(label: string, fallback: string): string {
  const cleaned = label
    .replace(/[[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .slice(0, 31)
    .trim();
  return cleaned || fallback;
}

/** `<title>-YYYY-MM-DD.xlsx`, with what a file system or a header cannot carry taken out. */
export function fileNameOf(title: string, now: Date): string {
  const stem =
    title
      .replace(/[\u0000-\u001f\u007f"*/:<>?\\|]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100) || "export";
  return `${stem}-${nicosiaDate(now)}.xlsx`;
}

/** `YYYY-MM-DD` of an instant, as the calendar on a wall in Nicosia reads. */
function nicosiaDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * The Nicosia wall-clock of an instant, as a "UTC" Date: exceljs writes a
 * Date's UTC fields, and Excel has no time zones, so this is how the cell
 * shows the hour a reader in Cyprus saw.
 */
function nicosiaWallClock(instant: Date): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)),
  );
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-11-24` or an ISO date-time → the calendar day as an Excel date; anything else → null. */
export function excelDate(value: string): Date | null {
  const trimmed = value.trim();
  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const date = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    // 30/02 would roll over to 02/03; a day that does not exist stays the text it was.
    return date.toISOString().slice(0, 10) === trimmed ? date : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
  const instant = new Date(trimmed);
  if (Number.isNaN(instant.getTime())) return null;
  const day = DATE_ONLY.exec(nicosiaDate(instant));
  return day ? new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]))) : null;
}

function isFigure(column: TableExportColumn): boolean {
  return column.kind === "money" || column.kind === "number";
}

/** A figure, or a rate — a number in the cell, but never totalled. */
function isNumeric(column: TableExportColumn): boolean {
  return isFigure(column) || column.kind === "percent";
}

/**
 * ADR-0038: `=ROUND(C2*D2,2)` or `=C2+E2` for one row, the screen's own figure as the
 * cached result so a reader without recalculation still sees it. Null when
 * the row has no figure in a column the formula needs: a blank stays blank.
 */
function formulaCell(
  column: TableExportColumn,
  rowNumber: number,
  values: TableExportCell[],
  result: ExcelJS.CellValue,
): ExcelJS.CellFormulaValue | null {
  const formula = column.formula;
  if (!formula) return null;
  const [a, b] = formula.columns;
  if (typeof values[a] !== "number" || typeof values[b] !== "number") return null;
  const left = `${columnLetter(a + 1)}${rowNumber}`;
  const right = `${columnLetter(b + 1)}${rowNumber}`;
  // VAT is rounded to the cent per row, as the database rounds it (0031).
  return {
    formula: formula.op === "multiply" ? `ROUND(${left}*${right},2)` : `${left}+${right}`,
    result: typeof result === "number" ? result : undefined,
  } as ExcelJS.CellFormulaValue;
}

/** What one cell holds. A figure that arrived as text ("1234.50") is read as the number it is. */
function cellValue(column: TableExportColumn, value: TableExportCell): ExcelJS.CellValue {
  if (value === null || value === "") return null;
  if (isNumeric(column)) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value.trim());
    return typeof value === "boolean" ? String(value) : value;
  }
  if (column.kind === "date") {
    if (typeof value === "string") return excelDate(value) ?? value;
    return typeof value === "boolean" ? String(value) : value;
  }
  return value;
}

/** Whole numbers get `#,##0`, anything with a fraction `#,##0.00`. */
function numberFormat(rows: TableExportCell[][], index: number): string {
  const fractional = rows.some((row) => {
    const value = row[index];
    return typeof value === "number" && !Number.isInteger(value);
  });
  return fractional ? DECIMAL_FORMAT : INTEGER_FORMAT;
}

function displayLength(value: ExcelJS.CellValue): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 10;
  if (typeof value === "number") return Math.min(18, String(Math.round(value)).length + 6);
  return String(value).length;
}

export interface TableWorkbookOptions {
  locale: Locale;
  now: Date;
}

export async function tableWorkbook(
  request: TableExportRequest,
  i18n: I18nService,
  { locale, now }: TableWorkbookOptions,
): Promise<Buffer> {
  const word = (key: string) => i18n.translate(`tableExport.${key}`, locale);
  const { columns, rows } = request;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = now;
  workbook.calcProperties.fullCalcOnLoad = true;

  const dataName = sheetNameOf(request.sheetName, word("dataSheet"));
  let infoName = sheetNameOf(word("infoSheet"), "Info");
  if (infoName.toLowerCase() === dataName.toLowerCase()) infoName = sheetNameOf(`${infoName} (2)`, "Info");

  const sheet = workbook.addWorksheet(dataName, { views: [{ state: "frozen", ySplit: 1 }] });
  const firstRow = 2;
  const lastRow = rows.length + 1;

  // ----- header
  const header = sheet.getRow(1);
  columns.forEach((column, i) => {
    const cell = header.getCell(i + 1);
    cell.value = column.header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true, horizontal: column.numeric ? "right" : "left" };
  });

  // ----- rows
  const formats = columns.map((column, i) =>
    column.kind === "money"
      ? MONEY_FORMAT
      : column.kind === "number"
        ? numberFormat(rows, i)
        : column.kind === "date"
          ? DATE_FORMAT
          : column.kind === "percent"
            ? PERCENT_FORMAT
            : undefined,
  );
  const widths = columns.map((column) => Math.max(10, column.header.length + 2));
  rows.forEach((values, r) => {
    const row = sheet.getRow(firstRow + r);
    columns.forEach((column, i) => {
      const cell = row.getCell(i + 1);
      const value = cellValue(column, values[i] ?? null);
      // ADR-0038: VAT and gross stay live — a formula over the row's net and
      // rate, never the figure pasted in.
      const formula = formulaCell(column, firstRow + r, values, value);
      if (formula) cell.value = formula;
      else if (value !== null) cell.value = value;
      const format = formats[i];
      if (format) cell.numFmt = format;
      if (column.numeric) cell.alignment = { horizontal: "right" };
      widths[i] = Math.max(widths[i] ?? 10, displayLength(value) + 2);
    });
  });
  widths.forEach((width, i) => {
    sheet.getColumn(i + 1).width = Math.min(60, width);
  });

  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: columns.length } };

    // ----- totals: live SUBTOTAL(9,…), so a filter moves them.
    if (columns.some(isFigure)) {
      const totals = sheet.getRow(lastRow + 1);
      const labelAt = columns.findIndex((column) => !isFigure(column));
      columns.forEach((column, i) => {
        const cell = totals.getCell(i + 1);
        cell.font = { bold: true };
        cell.border = { top: { style: "thin" } };
        if (isFigure(column)) {
          const letter = columnLetter(i + 1);
          cell.value = { formula: `SUBTOTAL(9,${letter}${firstRow}:${letter}${lastRow})` } as ExcelJS.CellFormulaValue;
          const format = formats[i];
          if (format) cell.numFmt = format;
          cell.alignment = { horizontal: "right" };
        } else if (i === labelAt) {
          cell.value = word("total");
        }
      });
    }
  }

  // ----- where the rows came from
  const info = workbook.addWorksheet(infoName);
  const quotedData = `'${dataName.replace(/'/g, "''")}'`;
  const lines: Array<[string, ExcelJS.CellValue, string | undefined]> = [
    [word("screen"), request.title, undefined],
    [word("source"), request.source ?? "", undefined],
    [word("exportedAt"), nicosiaWallClock(now), DATE_TIME_FORMAT],
    // A formula over the data range, not the count pasted in: the reader
    // can click it and see which rows it covers.
    [
      word("rowCount"),
      rows.length > 0 ? ({ formula: `ROWS(${quotedData}!A${firstRow}:A${lastRow})` } as ExcelJS.CellFormulaValue) : 0,
      INTEGER_FORMAT,
    ],
  ];
  lines.forEach(([label, value, format], i) => {
    const row = info.getRow(i + 1);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = value;
    if (format) row.getCell(2).numFmt = format;
    row.getCell(2).alignment = { horizontal: "left" };
  });
  const note = info.getRow(lines.length + 2).getCell(1);
  note.value = word("note");
  note.alignment = { wrapText: true, vertical: "top" };
  info.mergeCells(lines.length + 2, 1, lines.length + 2, 2);
  info.getRow(lines.length + 2).height = 48;
  info.getColumn(1).width = 30;
  info.getColumn(2).width = 60;

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
