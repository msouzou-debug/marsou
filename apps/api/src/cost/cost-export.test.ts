import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { AccrualRow, CostCategoryRow } from "@ecapital/shared";
import { I18nService } from "../common/i18n.service";
import { accrualsWorkbook, projectCostWorkbook } from "./cost-export";

/**
 * R18, R13 — ADR-0021 §13: nothing writes a calculated value into a
 * calculated column, the totals included. The screenshot review of
 * 19/09/2026 found the project sheet's totals «Απόκλιση» cell was a
 * `SUM` over the row formulas, which drops a category whose row formula
 * came back blank — these tests read the workbook back and check the
 * actual formula text in each calculated cell.
 */
async function firstSheet(buffer: Buffer): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's own .d.ts shadows the global `Buffer` with a local, non-generic
  // one (see `sap-extract.reader.ts`'s own cast) — same workaround here.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("no sheet");
  return sheet;
}

describe("projectCostWorkbook", () => {
  const i18n = new I18nService();

  it("totals «Απόκλιση» as a live formula on the totals row, not SUM(F...)", async () => {
    const categories: CostCategoryRow[] = [
      { category: "works", approved: 100, committed: 100, spent: 100, forecast: null, variance: null },
      { category: "fees", approved: null, committed: null, spent: null, forecast: 200, variance: null },
    ];
    const buffer = await projectCostWorkbook({ code: "PRJ-1", titleEl: "Έργο", categories }, i18n);
    const sheet = await firstSheet(buffer);

    // Row 3 = works (B=100, E blank), row 4 = fees (B blank, E=200), row 5 = totals.
    const totalsRow = sheet.getRow(5);
    const totalsF = totalsRow.getCell("F").formula;
    expect(totalsF).toBe('IF(OR(E5="",B5=""),"",E5-B5)');
    // Not a SUM over the (partly blank) row formulas — that would silently
    // drop whichever category has only one of the two ledgers.
    expect(totalsF).not.toMatch(/^SUM/);
  });

  it("keeps the per-row «Απόκλιση» and the other totals as SUM formulas", async () => {
    const categories: CostCategoryRow[] = [
      { category: "works", approved: 100, committed: 50, spent: 40, forecast: 90, variance: -10 },
    ];
    const buffer = await projectCostWorkbook({ code: "PRJ-1", titleEl: "Έργο", categories }, i18n);
    const sheet = await firstSheet(buffer);

    const row3 = sheet.getRow(3);
    expect(row3.getCell("F").formula).toBe('IF(OR(E3="",B3=""),"",E3-B3)');

    const totalsRow = sheet.getRow(4);
    expect(totalsRow.getCell("B").formula).toBe("SUM(B3:B3)");
    expect(totalsRow.getCell("E").formula).toBe("SUM(E3:E3)");
  });
});

describe("accrualsWorkbook", () => {
  const i18n = new I18nService();

  it("clamps the accrual formula to zero, never a negative value", async () => {
    const rows: AccrualRow[] = [
      {
        projectId: "p-1",
        projectCode: "PRJ-1",
        projectTitleEl: "Έργο",
        contractId: "c-1",
        contractRef: "CAP-1",
        contractorName: "Ανάδοχος",
        costCentre: "CC-1",
        certNumber: 1,
        certifiedNet: 100,
        invoiced: 670.55,
        accrual: 0,
        overInvoiced: true,
        asOf: "2026-12-31",
      },
    ];
    const buffer = await accrualsWorkbook(rows, 2026, i18n);
    const sheet = await firstSheet(buffer);

    const row3 = sheet.getRow(3);
    expect(row3.getCell("H").formula).toBe("MAX(0,F3-G3)");

    // The totals column keeps a plain SUM — over-invoicing is clamped at the
    // row, not hidden from the total.
    const totalsRow = sheet.getRow(4);
    expect(totalsRow.getCell("H").formula).toBe("SUM(H3:H3)");
  });
});
