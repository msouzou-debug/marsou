import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { TableExportRequest } from "@ecapital/shared";
import { I18nService } from "../common/i18n.service";
import { DATE_FORMAT, MONEY_FORMAT, excelDate, fileNameOf, sheetNameOf, tableWorkbook } from "./table-export";

/**
 * UAT 25/11/2026 — the generic table export. The owner's rule: the file is
 * live and auditable, so these read the workbook back and check the formula
 * text and the formats, not just that a file came out.
 */
async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's .d.ts shadows the global `Buffer` (see cost-export.test.ts).
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

const i18n = new I18nService();
const now = new Date("2026-11-25T08:30:00Z"); // 10:30 in Nicosia

const request = TableExportRequest.parse({
  title: "Πιστοποιήσεις πληρωμής",
  sheetName: "Πιστοποιήσεις: Σύμβαση/1",
  source: "/contracts/1/payment-certs",
  columns: [
    { header: "Αριθμός", numeric: true, kind: "text" },
    { header: "Περίοδος", kind: "date" },
    { header: "Καθαρό πληρωτέο", numeric: true, kind: "money" },
    { header: "Ημέρες", numeric: true, kind: "number" },
    { header: "Κατάσταση", kind: "text" },
  ],
  rows: [
    [1, "2026-10-01", 1234.56, 3, "Εγκρίθηκε"],
    [2, "2026-11-24T22:30:00Z", 100, 2, null],
    [3, null, null, null, "Πρόχειρο"],
  ],
});

describe("tableWorkbook", () => {
  it("writes a bold frozen header, an autofilter over header and rows, and live SUBTOTAL totals", async () => {
    const workbook = await load(await tableWorkbook(request, i18n, { locale: "el", now }));
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("no sheet");

    expect(sheet.name).toBe("Πιστοποιήσεις Σύμβαση 1");
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.getCell("A1").value).toBe("Αριθμός");
    expect(sheet.getCell("A1").font?.bold).toBe(true);
    // Header and the three rows; the totals row (5) stays out of the filter.
    expect(sheet.autoFilter).toBe("A1:E4");

    // Totals: formulas, never the answer pasted in; only under money and number columns.
    expect(sheet.getCell("C5").formula).toBe("SUBTOTAL(9,C2:C4)");
    expect(sheet.getCell("D5").formula).toBe("SUBTOTAL(9,D2:D4)");
    expect(sheet.getCell("A5").value).toBe("Σύνολο");
    expect(sheet.getCell("B5").value).toBeNull();
    expect(sheet.getCell("E5").value).toBeNull();
  });

  it("formats money as € with two decimals and dates as real dd/mm/yyyy dates", async () => {
    const workbook = await load(await tableWorkbook(request, i18n, { locale: "el", now }));
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("no sheet");

    expect(sheet.getCell("C2").value).toBe(1234.56);
    expect(sheet.getCell("C2").numFmt).toBe(MONEY_FORMAT);
    expect(sheet.getCell("C5").numFmt).toBe(MONEY_FORMAT);
    expect(MONEY_FORMAT).toBe('#,##0.00 "€"');

    const date = sheet.getCell("B2").value;
    expect(date).toBeInstanceOf(Date);
    expect((date as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(sheet.getCell("B2").numFmt).toBe(DATE_FORMAT);
    // 22:30 UTC on the 24th is already the 25th in Nicosia.
    expect((sheet.getCell("B3").value as Date).toISOString()).toBe("2026-11-25T00:00:00.000Z");

    // A blank on the screen is a blank cell, never 0.
    expect(sheet.getCell("C4").value).toBeNull();
    expect(sheet.getCell("E3").value).toBeNull();
    expect(sheet.getCell("D2").numFmt).toBe("#,##0");
  });

  it("adds a sheet that says which screen, which path, when, and counts the rows with a formula", async () => {
    const workbook = await load(await tableWorkbook(request, i18n, { locale: "el", now }));
    const info = workbook.worksheets[1];
    if (!info) throw new Error("no info sheet");
    expect(info.name).toBe("Πληροφορίες");
    expect(info.getCell("A1").value).toBe("Οθόνη");
    expect(info.getCell("B1").value).toBe("Πιστοποιήσεις πληρωμής");
    expect(info.getCell("B2").value).toBe("/contracts/1/payment-certs");
    expect((info.getCell("B3").value as Date).toISOString()).toBe("2026-11-25T10:30:00.000Z");
    expect(info.getCell("B3").numFmt).toBe("dd/mm/yyyy hh:mm");
    expect(info.getCell("B4").formula).toBe("ROWS('Πιστοποιήσεις Σύμβαση 1'!A2:A4)");
  });

  it("speaks English when the caller does", async () => {
    const workbook = await load(await tableWorkbook(request, i18n, { locale: "en", now }));
    expect(workbook.worksheets[0]?.getCell("A5").value).toBe("Total");
    expect(workbook.worksheets[1]?.name).toBe("About");
  });

  it("writes an empty table with its header and no totals", async () => {
    const empty = TableExportRequest.parse({ ...request, rows: [] });
    const workbook = await load(await tableWorkbook(empty, i18n, { locale: "el", now }));
    const sheet = workbook.worksheets[0];
    expect(sheet?.getCell("A1").value).toBe("Αριθμός");
    expect(sheet?.getCell("C2").value).toBeNull();
    expect(workbook.worksheets[1]?.getCell("B4").value).toBe(0);
  });
});

describe("VAT columns (ADR-0038)", () => {
  const vat = TableExportRequest.parse({
    title: "Συμβάσεις",
    sheetName: "Συμβάσεις",
    columns: [
      { header: "Σύμβαση", kind: "text" },
      { header: "Καθαρό ποσό", numeric: true, kind: "money" },
      { header: "Συντελεστής ΦΠΑ", numeric: true, kind: "percent" },
      { header: "Ποσό ΦΠΑ", numeric: true, kind: "money", formula: { op: "multiply", columns: [1, 2] } },
      { header: "Σύνολο με ΦΠΑ", numeric: true, kind: "money", formula: { op: "add", columns: [1, 3] } },
    ],
    rows: [
      ["CAP-2026-0001", 100_000, 0.19, 19_000, 119_000],
      ["CAP-2026-0002", 2_000, 0, 0, 2_000],
      ["CAP-2026-0003", null, 0.05, null, null],
    ],
  });

  it("writes VAT as =ROUND(net*rate,2) and gross as =net+vat, row by row, with the screen's figure cached", async () => {
    const workbook = await load(await tableWorkbook(vat, i18n, { locale: "el", now }));
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("no sheet");
    expect(sheet.getCell("C2").value).toBe(0.19);
    expect(sheet.getCell("C2").numFmt).toBe("0%");
    expect(sheet.getCell("D2").formula).toBe("ROUND(B2*C2,2)");
    expect(sheet.getCell("E2").formula).toBe("B2+D2");
    expect(sheet.getCell("D3").formula).toBe("ROUND(B3*C3,2)");
    expect(sheet.getCell("E2").result).toBe(119_000);
    // No net on the row: blank, not a formula that reads as 0.
    expect(sheet.getCell("D4").value).toBeNull();
    // Totals under the money columns, never under the rate.
    expect(sheet.getCell("B5").formula).toBe("SUBTOTAL(9,B2:B4)");
    expect(sheet.getCell("D5").formula).toBe("SUBTOTAL(9,D2:D4)");
    expect(sheet.getCell("E5").formula).toBe("SUBTOTAL(9,E2:E4)");
    expect(sheet.getCell("C5").value).toBeNull();
  });

  it("refuses a formula that names itself or a column the table does not have", () => {
    const columns = vat.columns.map((column, i) =>
      i === 3 ? { ...column, formula: { op: "multiply" as const, columns: [3, 9] as [number, number] } } : column,
    );
    expect(TableExportRequest.safeParse({ ...vat, columns }).success).toBe(false);
  });
});

describe("TableExportRequest", () => {
  it("refuses a row with the wrong number of values and more rows than the cap", () => {
    expect(
      TableExportRequest.safeParse({ ...request, rows: [[1, 2]] }).success,
    ).toBe(false);
    const tooMany = Array.from({ length: 20_001 }, () => [1, null, null, null, null]);
    expect(TableExportRequest.safeParse({ ...request, rows: tooMany }).success).toBe(false);
  });
});

describe("names", () => {
  it("cleans a sheet name to Excel's rules and a file name to `<title>-YYYY-MM-DD.xlsx`", () => {
    expect(sheetNameOf("a/b:c*d?[e]", "x")).toBe("a b c d e");
    expect(sheetNameOf("   ", "Δεδομένα")).toBe("Δεδομένα");
    expect(sheetNameOf("x".repeat(40), "y")).toHaveLength(31);
    expect(fileNameOf("Έργα / Λευκωσία", now)).toBe("Έργα Λευκωσία-2026-11-25.xlsx");
  });

  it("reads only real dates", () => {
    expect(excelDate("2026-02-30")).toBeNull();
    expect(excelDate("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(excelDate("Πρόχειρο")).toBeNull();
  });
});
