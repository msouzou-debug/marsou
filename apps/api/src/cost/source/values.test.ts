import { describe, expect, it } from "vitest";
import { applySign, isPeriod, parseAmount, parseDate, periodEnd, periodStart } from "./values";

/**
 * R14, R15. The formats a Greek SAP client actually produces, and the one
 * rule that matters more than any of them: a cell that cannot be read is
 * refused and never coerced (ADR-0016, CAPEX-03 §5 V06). A reader that
 * answers zero for «περίπου 3.000» produces a reconciliation that ties
 * perfectly to a file that is wrong.
 */
describe("parseAmount", () => {
  it("reads the European format SAP exports in Greek", () => {
    expect(parseAmount("1.234,56", "european")).toBe(1234.56);
    expect(parseAmount("120.000,00", "european")).toBe(120000);
    expect(parseAmount("1.234.567,89", "european")).toBe(1234567.89);
    expect(parseAmount("0,05", "european")).toBe(0.05);
  });

  it("reads the Anglo format, for a client exported in English", () => {
    expect(parseAmount("1,234.56", "anglo")).toBe(1234.56);
    expect(parseAmount("1,234,567.89", "anglo")).toBe(1234567.89);
  });

  it("decides for itself when the profile says auto", () => {
    expect(parseAmount("1.234,56", "auto")).toBe(1234.56);
    expect(parseAmount("1,234.56", "auto")).toBe(1234.56);
    // One separator with three digits behind it is a thousands separator.
    expect(parseAmount("1.234", "auto")).toBe(1234);
    expect(parseAmount("1,234", "auto")).toBe(1234);
    // Two digits behind it is a decimal.
    expect(parseAmount("12,50", "auto")).toBe(12.5);
  });

  it("reads SAP's trailing minus and its credit marker as negative", () => {
    expect(parseAmount("2.400,00-", "european")).toBe(-2400);
    expect(parseAmount("-2.400,00", "european")).toBe(-2400);
    expect(parseAmount("2.400,00 CR", "european")).toBe(-2400);
    expect(parseAmount("(2.400,00)", "european")).toBe(-2400);
  });

  it("drops the currency decoration and takes a number as it stands", () => {
    expect(parseAmount("€ 1.500,00", "european")).toBe(1500);
    expect(parseAmount("1.500,00 EUR", "european")).toBe(1500);
    expect(parseAmount(1500.25, "european")).toBe(1500.25);
  });

  it("refuses a cell that is not a number, instead of reading it as zero", () => {
    expect(parseAmount("περίπου 3.000", "european")).toBeNull();
    expect(parseAmount("", "european")).toBeNull();
    expect(parseAmount("  ", "european")).toBeNull();
    expect(parseAmount("n/a", "european")).toBeNull();
    expect(parseAmount(null, "european")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the dotted format SAP writes", () => {
    expect(parseDate("31.03.2026", "dmy_dot")).toBe("2026-03-31");
    expect(parseDate("1.1.2026", "dmy_dot")).toBe("2026-01-01");
  });

  it("reads slashes and ISO too, whatever the profile names", () => {
    expect(parseDate("31/03/2026", "dmy_dot")).toBe("2026-03-31");
    expect(parseDate("2026-03-31", "dmy_dot")).toBe("2026-03-31");
    expect(parseDate("2026-03-31T09:15:00Z", "auto")).toBe("2026-03-31");
  });

  it("reads a real date cell, which is what an .xlsx usually holds", () => {
    expect(parseDate(new Date("2026-03-31T00:00:00Z"), "auto")).toBe("2026-03-31");
  });

  it("takes a two-digit year as this century", () => {
    expect(parseDate("31.03.26", "dmy_dot")).toBe("2026-03-31");
  });

  it("refuses a date that is not one", () => {
    expect(parseDate("31.02.2026", "dmy_dot")).toBeNull();
    expect(parseDate("προς επιβεβαίωση", "dmy_dot")).toBeNull();
    expect(parseDate("", "dmy_dot")).toBeNull();
  });
});

describe("applySign", () => {
  it("leaves a debit posting alone and turns a vendor credit round", () => {
    expect(applySign(1000, "as_posted")).toBe(1000);
    expect(applySign(-1000, "as_posted")).toBe(-1000);
    // FBL1N posts a vendor invoice as a credit: negative in the file, spend
    // in the ledger. Its credit note goes the other way for the same reason.
    expect(applySign(-1000, "invert")).toBe(1000);
    expect(applySign(1000, "invert")).toBe(-1000);
  });

  it("never hands back a negative zero", () => {
    expect(Object.is(applySign(0, "invert"), -0)).toBe(false);
  });
});

describe("periods", () => {
  it("accepts YYYY-MM and nothing else", () => {
    expect(isPeriod("2026-03")).toBe(true);
    expect(isPeriod("2026-13")).toBe(false);
    expect(isPeriod("2026-3")).toBe(false);
    expect(isPeriod("2026")).toBe(false);
  });

  it("knows where a month starts and ends", () => {
    expect(periodStart("2026-03")).toBe("2026-03-01");
    expect(periodEnd("2026-03")).toBe("2026-03-31");
    expect(periodEnd("2026-02")).toBe("2026-02-28");
    expect(periodEnd("2028-02")).toBe("2028-02-29");
  });
});
