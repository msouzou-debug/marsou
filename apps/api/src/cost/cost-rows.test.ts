import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORECAST_INPUTS,
  accrualOf,
  categoryOf,
  costToCompleteOf,
  derivePaymentCert,
  forecastOf,
  sortCategories,
  toCategoryRow,
  varianceOf,
} from "./cost-rows";

/**
 * R11, R13, R16. The arithmetic of the four ledgers and of a payment
 * certificate, tested without a database because it is a pure function of
 * the figures and because these are the sums somebody will check by hand.
 */
describe("derivePaymentCert", () => {
  it("holds retention on the gross and pays the difference since last time", () => {
    // packages/shared: retentionHeld = retentionPct × (workDone + materials),
    // and workDoneValue is cumulative, so the earlier certificates come off.
    const derived = derivePaymentCert({
      workDoneValue: 200_000,
      materialsOnSite: 20_000,
      retentionPct: 5,
      previousCertified: 120_000,
    });
    expect(derived.gross).toBe(220_000);
    expect(derived.retentionHeld).toBe(11_000);
    expect(derived.previousCertified).toBe(120_000);
    expect(derived.netPayable).toBe(89_000);
  });

  it("is the whole gross less retention on the first certificate", () => {
    const derived = derivePaymentCert({
      workDoneValue: 50_000,
      materialsOnSite: 0,
      retentionPct: 10,
      previousCertified: 0,
    });
    expect(derived.retentionHeld).toBe(5_000);
    expect(derived.netPayable).toBe(45_000);
  });

  it("holds nothing where the contract holds no retention", () => {
    const derived = derivePaymentCert({
      workDoneValue: 10_000,
      materialsOnSite: 500,
      retentionPct: 0,
      previousCertified: 0,
    });
    expect(derived.retentionHeld).toBe(0);
    expect(derived.netPayable).toBe(10_500);
  });

  it("rounds to the cent and not further", () => {
    const derived = derivePaymentCert({
      workDoneValue: 33_333.33,
      materialsOnSite: 0,
      retentionPct: 5,
      previousCertified: 0,
    });
    expect(derived.retentionHeld).toBe(1_666.67);
    expect(derived.netPayable).toBe(31_666.66);
  });
});

describe("forecastOf", () => {
  it("is the commitment plus the weighted proposals plus the contingency", () => {
    expect(
      forecastOf({
        committed: 1_000_000,
        pendingVariations: 100_000,
        inputs: { contingency: 50_000, pendingVariationWeight: 0.5, contingencyNoteEl: null },
      }),
    ).toBe(1_100_000);
  });

  it("counts an approved variation once, because it is already committed", () => {
    // ADR-0015: contract.current_value is original + approved variations, so
    // the forecast takes the commitment as it stands and adds only what has
    // not been decided.
    expect(
      forecastOf({
        committed: 1_200_000,
        pendingVariations: 0,
        inputs: DEFAULT_FORECAST_INPUTS,
      }),
    ).toBe(1_200_000);
  });

  it("is null when nothing gives it a source", () => {
    expect(
      forecastOf({ committed: null, pendingVariations: 0, inputs: DEFAULT_FORECAST_INPUTS }),
    ).toBeNull();
  });

  it("exists on a contingency alone, because somebody set one", () => {
    expect(
      forecastOf({
        committed: null,
        pendingVariations: 0,
        inputs: { contingency: 25_000, pendingVariationWeight: 0.5, contingencyNoteEl: null },
      }),
    ).toBe(25_000);
  });
});

describe("costToComplete and variance", () => {
  it("is the forecast less what has been spent", () => {
    expect(costToCompleteOf(1_000_000, 400_000)).toBe(600_000);
  });

  it("treats no spend as nothing spent, and no forecast as no answer", () => {
    expect(costToCompleteOf(1_000_000, null)).toBe(1_000_000);
    expect(costToCompleteOf(null, 400_000)).toBeNull();
  });

  it("is silent about a variance it cannot work out", () => {
    expect(varianceOf(1_100_000, 1_000_000)).toBe(100_000);
    expect(varianceOf(null, 1_000_000)).toBeNull();
    expect(varianceOf(1_100_000, null)).toBeNull();
  });
});

describe("categories", () => {
  it("puts money with no category in the bucket", () => {
    expect(categoryOf(null)).toBe("uncategorised");
    expect(categoryOf("")).toBe("uncategorised");
    expect(categoryOf("NEW_BUILD")).toBe("uncategorised");
    expect(categoryOf("works")).toBe("works");
  });

  it("keeps a ledger with no source null rather than zero", () => {
    const row = toCategoryRow("works", {
      approved: 100_000,
      committed: null,
      spent: null,
      forecast: null,
    });
    expect(row.committed).toBeNull();
    expect(row.spent).toBeNull();
    expect(row.variance).toBeNull();
  });

  it("reads in the order S04 shows, with the bucket last", () => {
    const rows = sortCategories([
      toCategoryRow("uncategorised", { approved: 1, committed: null, spent: null, forecast: null }),
      toCategoryRow("fees", { approved: 1, committed: null, spent: null, forecast: null }),
      toCategoryRow("works", { approved: 1, committed: null, spent: null, forecast: null }),
    ]);
    expect(rows.map((row) => row.category)).toEqual(["works", "fees", "uncategorised"]);
  });
});

describe("accrualOf", () => {
  // RULE (screenshot review 19/09/2026, R18): certified − invoiced, but
  // never negative — a seeded LAR row showed −570.550 €, which is
  // over-invoicing, not an accrual.
  it("is certified net less invoiced when work is ahead of billing", () => {
    expect(accrualOf(480_000, 420_000)).toEqual({ accrual: 60_000, overInvoiced: false });
  });

  it("clamps to zero and flags over-invoicing when invoiced exceeds certified", () => {
    expect(accrualOf(1_000_000, 1_570_550)).toEqual({ accrual: 0, overInvoiced: true });
  });

  it("is not over-invoiced when the two are exactly equal", () => {
    expect(accrualOf(100_000, 100_000)).toEqual({ accrual: 0, overInvoiced: false });
  });
});
