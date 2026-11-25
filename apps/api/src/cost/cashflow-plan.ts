/**
 * ADR-0037 — the cash-flow plan's Excel round trip, as pure functions.
 *
 * The template the API hands out and the file it reads back are the same
 * shape, written and read from the constants below:
 *
 *   A  Μήνας (μμ/εεεε)   text, never a date Excel may reinterpret
 *   B  Ποσό (€)          a number, at least zero
 *   C  Σημείωση          optional text
 *
 * Row 1 is Greek, row 2 English, the months start at row 3 (the same two
 * header rows every export in this app has, cost-export.ts). Beside the
 * months, in E:G, the three figures the owner asked to be live:
 *
 *   F3  =SUM(B:B)       the plan's total, which follows rows added anywhere
 *   F4  the approved budget, as a value — it comes from the budget lines
 *   F5  =F3-F4          the difference, plan minus budget
 *
 * RULE (owner): live, auditable formulas — a pasted total is not auditable.
 * Only A:C are read back, so the summary block can never be mistaken for a
 * month.
 *
 * RULE (owner): all or nothing. The reader returns every problem it finds
 * with the sheet's own row number; the service saves only when there are
 * none.
 */
import ExcelJS from "exceljs";
import type { CashflowPlanImportProblem, CashflowPlanMonth } from "@ecapital/shared";
import type { I18nService } from "../common/i18n.service";

const MONEY_FORMAT = "#,##0.00";
const HEADER_FILL = "FFEFEFEF";
export const PLAN_FIRST_DATA_ROW = 3;
const NOTE_MAX = 500;

export interface TemplateMonth {
  period: string;
  amount: number | null;
  note: string | null;
}

/** "2027-01" → "01/2027", the way the UI and the sheet show a month. */
export function periodToSheet(period: string): string {
  const [year, month] = period.split("-");
  return `${month}/${year}`;
}

export async function cashflowPlanWorkbook(
  input: { code: string; titleEl: string; approved: number; months: TemplateMonth[] },
  i18n: I18nService,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();
  // The two formulas carry their result too, for a viewer that does not
  // recalculate; Excel recalculates on open regardless.
  workbook.calcProperties.fullCalcOnLoad = true;
  const t = (key: string, locale: "el" | "en") => i18n.translate(`cost.cashflowPlan.${key}`, locale, {});
  const sheet = workbook.addWorksheet(t("sheet", "el"));

  const keys = ["month", "amount", "note"] as const;
  const greek = sheet.addRow(keys.map((key) => t(`columns.${key}`, "el")));
  const english = sheet.addRow(keys.map((key) => t(`columns.${key}`, "en")));
  for (const row of [greek, english]) {
    row.font = { bold: row === greek, size: 11 };
    for (const column of [1, 2, 3]) {
      const cell = row.getCell(column);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", wrapText: true };
    }
  }
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.columns = [{ width: 18 }, { width: 18 }, { width: 40 }, { width: 4 }, { width: 36 }, { width: 18 }, { width: 30 }];

  input.months.forEach((month, index) => {
    const row = sheet.getRow(PLAN_FIRST_DATA_ROW + index);
    const a = row.getCell(1);
    a.numFmt = "@";
    a.value = periodToSheet(month.period);
    const b = row.getCell(2);
    b.value = month.amount ?? 0;
    b.numFmt = MONEY_FORMAT;
    b.dataValidation = {
      type: "decimal",
      operator: "greaterThanOrEqual",
      formulae: [0],
      allowBlank: false,
      showErrorMessage: true,
      errorTitle: t("validationTitle", "el"),
      error: t("validationError", "el"),
    };
    if (month.note) row.getCell(3).value = month.note;
  });

  const total = round2(input.months.reduce((sum, month) => sum + (month.amount ?? 0), 0));
  const summary: Array<[number, string, ExcelJS.CellValue]> = [
    [3, "total", { formula: "SUM(B:B)", result: total } as ExcelJS.CellFormulaValue],
    [4, "approved", input.approved],
    [5, "difference", { formula: "F3-F4", result: round2(total - input.approved) } as ExcelJS.CellFormulaValue],
  ];
  for (const [at, key, value] of summary) {
    const row = sheet.getRow(at);
    row.getCell(5).value = t(`summary.${key}`, "el");
    row.getCell(5).font = { bold: true };
    const cell = row.getCell(6);
    cell.value = value;
    cell.numFmt = MONEY_FORMAT;
    cell.font = { bold: true };
    row.getCell(7).value = t(`summary.${key}`, "en");
  }
  const project = sheet.getRow(7);
  project.getCell(5).value = t("summary.project", "el");
  project.getCell(6).value = `${input.code} — ${input.titleEl}`;
  project.getCell(7).value = t("summary.project", "en");

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// ------------------------------------------------------------- reading --

export interface PlanSheetRow {
  /** The spreadsheet's own row number, 1-based. */
  rowNo: number;
  /** Columns A, B and C, already reduced to primitives by `plainCell`. */
  values: unknown[];
}

export interface PlanImportError {
  row: number;
  problem: CashflowPlanImportProblem;
  value: string | null;
}

export interface ParsedPlan {
  months: Array<CashflowPlanMonth>;
  errors: PlanImportError[];
}

/** The first sheet's A:C as primitives. Null when exceljs cannot open the file. */
export async function readPlanSheet(bytes: Buffer): Promise<PlanSheetRow[] | null> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;
  const rows: PlanSheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNo) => {
    rows.push({ rowNo, values: [1, 2, 3].map((column) => plainCell(row.getCell(column).value)) });
  });
  return rows;
}

/** A cell as the value a person sees: a formula's result, rich text's text. */
export function plainCell(value: ExcelJS.CellValue | undefined): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    if ("result" in value) return plainCell((value as { result?: ExcelJS.CellValue }).result);
    if ("formula" in value || "sharedFormula" in value) return null;
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String((value as { text: unknown }).text);
    if ("error" in value) return String((value as { error: unknown }).error);
    return null;
  }
  return value;
}

export function parsePlanSheet(rows: PlanSheetRow[]): ParsedPlan {
  const months: CashflowPlanMonth[] = [];
  const errors: PlanImportError[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.rowNo < PLAN_FIRST_DATA_ROW) continue;
    const [a, b, c] = row.values;
    if (isBlank(a) && isBlank(b) && isBlank(c)) continue;

    const before = errors.length;
    const period = toPeriod(a);
    if (period === null) {
      errors.push({ row: row.rowNo, problem: "periodNotValid", value: shown(a) });
    } else if (seen.has(period)) {
      errors.push({ row: row.rowNo, problem: "periodRepeated", value: shown(a) });
    }

    let amount: number | null = null;
    if (isBlank(b)) {
      errors.push({ row: row.rowNo, problem: "amountMissing", value: null });
    } else {
      amount = toAmount(b);
      if (amount === null) errors.push({ row: row.rowNo, problem: "amountNotNumber", value: shown(b) });
      else if (amount < 0) errors.push({ row: row.rowNo, problem: "amountNegative", value: shown(b) });
    }

    const note = isBlank(c) ? null : String(c instanceof Date ? c.toISOString().slice(0, 10) : c).trim();
    if (note !== null && note.length > NOTE_MAX) {
      errors.push({ row: row.rowNo, problem: "noteTooLong", value: null });
    }

    if (errors.length === before && period !== null && amount !== null) {
      seen.add(period);
      months.push({ period, amount, note: note || null });
    } else if (period !== null) {
      seen.add(period);
    }
  }

  if (!errors.length && !months.length) errors.push({ row: 0, problem: "noMonths", value: null });
  months.sort((x, y) => x.period.localeCompare(y.period));
  return { months, errors };
}

/**
 * «01/2027», «1/2027», «01.2027», «2027-01», or a cell Excel turned into a
 * date. Anything else is not a month.
 */
export function toPeriod(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return checked(value.getUTCFullYear(), value.getUTCMonth() + 1);
  }
  if (typeof value !== "string") return null;
  const text = value.trim();
  let match = /^(\d{1,2})\s*[/.-]\s*(\d{4})$/.exec(text);
  if (match) return checked(Number(match[2]), Number(match[1]));
  match = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (match) return checked(Number(match[1]), Number(match[2]));
  return null;
}

function checked(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * A number, or text that reads as one: «1.234,56» (Greek), «1234,56»,
 * «1234.56», with or without «€». Rounded to the cent.
 */
export function toAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : null;
  if (typeof value !== "string") return null;
  let text = value.replace(/[\s €]/g, "");
  if (!text) return null;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(text)) {
    // «1.234.567» with no decimals is thousands, the Greek way.
    text = text.replace(/\./g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function shown(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 60);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
