import { describe, expect, it } from "vitest";
import { DEFAULT_VAT_RATE, VAT_RATES, VAT_RATE_VALUE, grossOf, roundMoney, vatBreakdown, vatOf } from "./vat";

describe("VAT rates (ADR-0038)", () => {
  it("knows the five Cyprus rates, standard first", () => {
    expect(VAT_RATES).toEqual(["STANDARD_19", "REDUCED_9", "REDUCED_5", "ZERO", "EXEMPT"]);
    expect(DEFAULT_VAT_RATE).toBe("STANDARD_19");
    expect(VAT_RATE_VALUE).toEqual({ STANDARD_19: 0.19, REDUCED_9: 0.09, REDUCED_5: 0.05, ZERO: 0, EXEMPT: 0 });
  });
});

describe("roundMoney", () => {
  it("rounds half away from zero, like PostgreSQL round(numeric, 2)", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(1.004)).toBe(1);
    expect(roundMoney(-0.001)).toBe(0);
    expect(Object.is(roundMoney(-0.001), -0)).toBe(false);
  });
});

describe("vatOf and grossOf", () => {
  it("works out 19 % on a contract value", () => {
    expect(vatOf(100_000, "STANDARD_19")).toBe(19_000);
    expect(grossOf(100_000, "STANDARD_19")).toBe(119_000);
    expect(vatBreakdown(1_234.56, "STANDARD_19")).toEqual({ net: 1_234.56, vat: 234.57, gross: 1_469.13 });
  });

  it("rounds the half cent away from zero, both signs", () => {
    // 10.50 × 0.19 = 1.995 exactly; a double holds 1.99499…
    expect(vatOf(10.5, "STANDARD_19")).toBe(2);
    expect(vatOf(-10.5, "STANDARD_19")).toBe(-2);
    // 0.10 × 0.05 = 0.005 → 0.01
    expect(vatOf(0.1, "REDUCED_5")).toBe(0.01);
    expect(vatOf(0.3, "REDUCED_5")).toBe(0.02); // 0.015 → 0.02
  });

  it("charges nothing at ZERO or EXEMPT", () => {
    expect(vatOf(5_000, "ZERO")).toBe(0);
    expect(vatOf(5_000, "EXEMPT")).toBe(0);
    expect(grossOf(5_000, "EXEMPT")).toBe(5_000);
  });

  it("gives an omission variation a negative VAT and gross", () => {
    expect(vatBreakdown(-2_500, "REDUCED_9")).toEqual({ net: -2_500, vat: -225, gross: -2_725 });
  });

  it("adds up per row, so VAT on a sum may differ from the sum of VATs by a cent", () => {
    const rows = [0.05, 0.05, 0.05].map((net) => vatOf(net, "STANDARD_19"));
    expect(rows).toEqual([0.01, 0.01, 0.01]);
    expect(vatOf(0.15, "STANDARD_19")).toBe(0.03);
  });
});
