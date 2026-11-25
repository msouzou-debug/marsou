/**
 * R18, R13 — the two Excel exports, with live formulas.
 *
 * CAPEX-01 §7: "Year-end: accrual proposal listing work certified but not
 * invoiced, per project and cost centre, exportable to Excel with live
 * formulas." The owner was explicit about what that means: the accrual column
 * is `=F−G` in the cell, and the totals are `=SUM(…)`, so that whoever
 * receives the file can change a figure and watch the total move, and an
 * auditor can see the arithmetic rather than being told it.
 *
 * A pasted value is not auditable. Nothing in this file writes one into a
 * column that is a calculation.
 *
 * Both sheets carry Greek headers in row 1 and English in row 2 (CAPEX-01
 * §6.1: full parity, and a file that leaves the building is read by both).
 * Numbers use `#,##0.00`, which is what a finance desk expects and what makes
 * a rounded-looking figure obviously rounded.
 */
import ExcelJS from "exceljs";
import { type AccrualRow, type CostCategoryRow, VAT_RATE_VALUE } from "@ecapital/shared";
import type { I18nService } from "../common/i18n.service";

const MONEY_FORMAT = "#,##0.00";
const PERCENT_FORMAT = "0%";
const HEADER_FILL = "FFEFEFEF";

/** Row 1 Greek, row 2 English; the data starts at row 3. */
const FIRST_DATA_ROW = 3;

function headerRows(sheet: ExcelJS.Worksheet, el: string[], en: string[]): void {
  const greek = sheet.addRow(el);
  const english = sheet.addRow(en);
  for (const row of [greek, english]) {
    row.font = { bold: row === greek, size: 11 };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  }
  sheet.views = [{ state: "frozen", ySplit: 2 }];
}

/**
 * R18 — one sheet, one row per accrual and a totals row of `=SUM(...)`. The
 * columns are fixed in this order because the formulas name them:
 *
 *   F  certified net (the certificate's net payable, excl. VAT)
 *   G  VAT rate
 *   H  VAT            =ROUND(F*G,2)      (ADR-0038)
 *   I  certified gross =F+H              — what finance pays
 *   J  invoiced (posted gross)
 *   K  accrual        =MAX(0,I−J)        — gross against gross
 */
export async function accrualsWorkbook(
  rows: AccrualRow[],
  year: number,
  i18n: I18nService,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(i18n.translate("cost.export.accrualsSheet", "el", {}));

  const keys = [
    "projectCode",
    "projectTitle",
    "contractor",
    "contract",
    "certNumber",
    "certifiedNet",
    "vatRate",
    "vatAmount",
    "certifiedGross",
    "invoiced",
    "accrual",
    "costCentre",
    "asOf",
  ] as const;
  headerRows(
    sheet,
    keys.map((key) => i18n.translate(`cost.export.columns.${key}`, "el", {})),
    keys.map((key) => i18n.translate(`cost.export.columns.${key}`, "en", {})),
  );
  sheet.columns = [
    { width: 16 },
    { width: 44 },
    { width: 28 },
    { width: 18 },
    { width: 10 },
    { width: 18 },
    { width: 10 },
    { width: 16 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
  ];

  rows.forEach((row, index) => {
    const at = FIRST_DATA_ROW + index;
    const added = sheet.addRow([
      row.projectCode,
      row.projectTitleEl,
      row.contractorName,
      row.contractRef,
      row.certNumber,
      row.certifiedNet,
      VAT_RATE_VALUE[row.vatRate],
      // ADR-0038: VAT and gross are formulas over the net and the rate.
      { formula: `ROUND(F${at}*G${at},2)`, result: row.certifiedVat },
      { formula: `F${at}+H${at}`, result: row.certifiedGross },
      row.invoiced,
      // RULE (owner): a formula, never the answer. I − J, in the cell —
      // gross against gross (ADR-0038). Clamped to zero: invoiced above
      // certified is over-invoicing, not a negative accrual (screenshot
      // review 19/09/2026).
      { formula: `MAX(0,I${at}-J${at})`, result: row.accrual },
      row.costCentre ?? "",
      row.asOf,
    ]);
    for (const column of ["F", "H", "I", "J", "K"]) {
      added.getCell(column).numFmt = MONEY_FORMAT;
    }
    added.getCell("G").numFmt = PERCENT_FORMAT;
  });

  const totalsAt = FIRST_DATA_ROW + rows.length;
  const first = FIRST_DATA_ROW;
  const last = totalsAt - 1;
  const totals = sheet.addRow([
    i18n.translate("cost.export.total", "el", {}),
    i18n.translate("cost.export.total", "en", {}),
    "",
    "",
    "",
    rows.length ? { formula: `SUM(F${first}:F${last})` } : 0,
    "",
    rows.length ? { formula: `SUM(H${first}:H${last})` } : 0,
    rows.length ? { formula: `SUM(I${first}:I${last})` } : 0,
    rows.length ? { formula: `SUM(J${first}:J${last})` } : 0,
    rows.length ? { formula: `SUM(K${first}:K${last})` } : 0,
    "",
    `${year}`,
  ]);
  totals.font = { bold: true };
  for (const column of ["F", "H", "I", "J", "K"]) {
    totals.getCell(column).numFmt = MONEY_FORMAT;
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * R13 — the category table of one project. «Απόκλιση» is `=E−B`, forecast
 * against approved, and the totals are sums. Same rule as the accruals: the
 * calculated columns are calculations.
 */
export async function projectCostWorkbook(
  input: { code: string; titleEl: string; categories: CostCategoryRow[] },
  i18n: I18nService,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "eCapital";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(i18n.translate("cost.export.projectSheet", "el", {}));

  const keys = ["category", "approved", "committed", "spent", "forecast", "variance"] as const;
  headerRows(
    sheet,
    keys.map((key) => i18n.translate(`cost.export.columns.${key}`, "el", {})),
    keys.map((key) => i18n.translate(`cost.export.columns.${key}`, "en", {})),
  );
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];

  input.categories.forEach((row, index) => {
    const at = FIRST_DATA_ROW + index;
    // RULE (the ledger convention): a ledger with no source is empty in the
    // sheet too. A zero would be a figure somebody could add up.
    const added = sheet.addRow([
      i18n.translate(`cost.categories.${row.category}`, "el", {}),
      row.approved ?? "",
      row.committed ?? "",
      row.spent ?? "",
      row.forecast ?? "",
      { formula: `IF(OR(E${at}="",B${at}=""),"",E${at}-B${at})` },
    ]);
    for (const column of ["B", "C", "D", "E", "F"]) {
      added.getCell(column).numFmt = MONEY_FORMAT;
    }
  });

  const totalsAt = FIRST_DATA_ROW + input.categories.length;
  const first = FIRST_DATA_ROW;
  const last = totalsAt - 1;
  const totals = sheet.addRow([
    i18n.translate("cost.export.total", "el", {}),
    ...(input.categories.length
      ? ["B", "C", "D", "E"].map((column) => ({ formula: `SUM(${column}${first}:${column}${last})` }))
      : [0, 0, 0, 0]),
    // RULE: the totals' own Απόκλιση is E−B on the totals row, not
    // SUM(F...) — a category with only one of the two ledgers contributes
    // "" (blank) to F but still moves the B or E total, so summing F would
    // silently drop it. Same rule as the row cells: forecast − approved,
    // blank when either total is missing.
    input.categories.length
      ? { formula: `IF(OR(E${totalsAt}="",B${totalsAt}=""),"",E${totalsAt}-B${totalsAt})` }
      : 0,
  ]);
  totals.font = { bold: true };
  for (const column of ["B", "C", "D", "E", "F"]) {
    totals.getCell(column).numFmt = MONEY_FORMAT;
  }

  const title = sheet.addRow([]);
  title.getCell(1).value = `${input.code} — ${input.titleEl}`;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
