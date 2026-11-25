import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { I18nService } from "../common/i18n.service";
import {
  cashflowPlanWorkbook,
  parsePlanSheet,
  readPlanSheet,
  toAmount,
  toPeriod,
  type PlanSheetRow,
} from "./cashflow-plan";

/**
 * ADR-0037 — the plan's Excel round trip. The owner asked for live,
 * auditable formulas: the total and the difference are read back as
 * formulas, not as numbers. And all or nothing: every bad row is reported.
 */
const i18n = new I18nService();

function sheet(...rows: unknown[][]): PlanSheetRow[] {
  // Rows 1 and 2 are the headers; data starts at 3.
  return rows.map((values, index) => ({ rowNo: index + 3, values }));
}

describe("cashflowPlanWorkbook", () => {
  it("writes months as rows, a live SUM and a live difference to the budget", async () => {
    const buffer = await cashflowPlanWorkbook(
      {
        code: "PRJ-9",
        titleEl: "Έργο",
        approved: 1000,
        months: [
          { period: "2027-01", amount: 300, note: "Κινητοποίηση" },
          { period: "2027-02", amount: 500, note: null },
        ],
      },
      i18n,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = workbook.worksheets[0];
    expect(ws.getCell("A1").value).toBe("Μήνας (μμ/εεεε)");
    expect(ws.getCell("A2").value).toBe("Month (mm/yyyy)");
    expect(ws.getCell("A3").value).toBe("01/2027");
    expect(ws.getCell("B3").value).toBe(300);
    expect(ws.getCell("C3").value).toBe("Κινητοποίηση");
    expect(ws.getCell("A4").value).toBe("02/2027");
    // RULE (owner): formulas in the cell, never the answer pasted.
    expect(ws.getCell("F3").formula).toBe("SUM(B:B)");
    expect(ws.getCell("F4").value).toBe(1000);
    expect(ws.getCell("F5").formula).toBe("F3-F4");
    expect(ws.getCell("E5").value).toBe("Διαφορά (πλάνο − προϋπολογισμός)");
  });

  it("reads its own template back unchanged", async () => {
    const months = [
      { period: "2026-11", amount: 1234.56, note: "Α" },
      { period: "2026-12", amount: 0, note: null },
    ];
    const buffer = await cashflowPlanWorkbook({ code: "P", titleEl: "T", approved: 5000, months }, i18n);
    const rows = await readPlanSheet(buffer);
    expect(rows).not.toBeNull();
    const parsed = parsePlanSheet(rows ?? []);
    expect(parsed.errors).toEqual([]);
    expect(parsed.months).toEqual(months);
  });

  it("refuses a file that is not a workbook", async () => {
    expect(await readPlanSheet(Buffer.from("not a workbook"))).toBeNull();
  });
});

describe("parsePlanSheet", () => {
  it("reports every bad row with its sheet row number and keeps nothing back silently", () => {
    const parsed = parsePlanSheet(
      sheet(
        ["01/2027", 100, null],
        ["13/2027", 100, null],
        ["02/2027", "εκατό", null],
        ["03/2027", -5, null],
        ["01/2027", 10, null],
        ["04/2027", null, "χωρίς ποσό"],
        [null, null, null],
        ["05/2027", "1.234,50", "ελληνική μορφή"],
      ),
    );
    expect(parsed.errors.map((e) => [e.row, e.problem])).toEqual([
      [4, "periodNotValid"],
      [5, "amountNotNumber"],
      [6, "amountNegative"],
      [7, "periodRepeated"],
      [8, "amountMissing"],
    ]);
    expect(parsed.months.map((m) => [m.period, m.amount])).toEqual([
      ["2027-01", 100],
      ["2027-05", 1234.5],
    ]);
  });

  it("says so when the file has no months at all", () => {
    expect(parsePlanSheet(sheet([null, null, null])).errors).toEqual([
      { row: 0, problem: "noMonths", value: null },
    ]);
  });

  it("ignores the header rows", () => {
    const parsed = parsePlanSheet([
      { rowNo: 1, values: ["Μήνας (μμ/εεεε)", "Ποσό (€)", "Σημείωση"] },
      { rowNo: 2, values: ["Month (mm/yyyy)", "Amount (€)", "Note"] },
      { rowNo: 3, values: ["2027-06", 50, null] },
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.months).toEqual([{ period: "2027-06", amount: 50, note: null }]);
  });
});

describe("toPeriod and toAmount", () => {
  it("reads the month the ways people type it, and a date Excel made of it", () => {
    expect(toPeriod("01/2027")).toBe("2027-01");
    expect(toPeriod("1/2027")).toBe("2027-01");
    expect(toPeriod("2027-12")).toBe("2027-12");
    expect(toPeriod(new Date(Date.UTC(2027, 2, 1)))).toBe("2027-03");
    expect(toPeriod("2027/13")).toBeNull();
    expect(toPeriod(202701)).toBeNull();
  });

  it("reads Greek and plain amounts, to the cent", () => {
    expect(toAmount(1000.005)).toBe(1000.01);
    expect(toAmount("1.234,56 €")).toBe(1234.56);
    expect(toAmount("1.234.567")).toBe(1234567);
    expect(toAmount("1234.5")).toBe(1234.5);
    expect(toAmount("abc")).toBeNull();
  });
});
