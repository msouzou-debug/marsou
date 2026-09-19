import { describe, expect, it } from "vitest";
import {
  VARIATION_LIMIT_PCT,
  addDays,
  daysBetween,
  formatDate,
  formatEuro,
  formatPct,
  toBoqItem,
  warningFacts,
  type WarningInput,
} from "./contract-rows";

/**
 * R31 — the three warn-and-flag rules, tested as what they are: arithmetic on
 * a row. No database, no request, no clock; the day is an argument, so the
 * test says the same thing in September as it does in March.
 */
const base: WarningInput = {
  contractNo: "ΤΥ/2026/014",
  projectTitleEl: "Ανακαίνιση χειρουργείων",
  originalValue: 1_000_000,
  approvedVariationsTotal: 0,
  bondExpiry: null,
  completionDate: null,
  extensionDays: 0,
  projectPhase: "IN_PROGRESS",
};

const TODAY = "2026-09-19";

describe("warningFacts", () => {
  it("says nothing about a contract that is behaving", () => {
    expect(warningFacts(base, TODAY)).toEqual([]);
  });

  it("stays quiet at exactly a tenth and fires above it", () => {
    expect(VARIATION_LIMIT_PCT).toBe(10);
    const atTheLimit = warningFacts({ ...base, approvedVariationsTotal: 100_000 }, TODAY);
    expect(atTheLimit).toEqual([]);

    const over = warningFacts({ ...base, approvedVariationsTotal: 140_000 }, TODAY);
    expect(over).toHaveLength(1);
    expect(over[0].key).toBe("variationsOverTenPct");
    // The amount is the excess over the mark, which is the figure somebody
    // has to explain — not the total.
    expect(over[0].amount).toBe(40_000);
    expect(over[0].facts.pct).toBe(14);
  });

  it("ignores the variation rule on a contract with no value to compare against", () => {
    expect(
      warningFacts({ ...base, originalValue: 0, approvedVariationsTotal: 5_000 }, TODAY),
    ).toEqual([]);
  });

  it("fires on a bond that expired and not on one that has not", () => {
    expect(warningFacts({ ...base, bondExpiry: "2026-09-18" }, TODAY).map((f) => f.key)).toEqual([
      "bondExpired",
    ]);
    expect(warningFacts({ ...base, bondExpiry: TODAY }, TODAY)).toEqual([]);
    expect(warningFacts({ ...base, bondExpiry: "2027-01-01" }, TODAY)).toEqual([]);
  });

  it("counts the extension before it calls a completion date late", () => {
    const late = { ...base, completionDate: "2026-08-01" };
    expect(warningFacts(late, TODAY).map((f) => f.key)).toEqual(["completionPast"]);
    expect(warningFacts(late, TODAY)[0].facts.days).toBe(49);

    // Sixty days of extension carry it past today, so there is nothing to say.
    expect(warningFacts({ ...late, extensionDays: 60 }, TODAY)).toEqual([]);
  });

  it("goes quiet on the completion date once the works are practically complete", () => {
    const late = { ...base, completionDate: "2026-08-01" };
    for (const phase of ["PRACTICAL_COMPLETION", "DEFECTS_LIABILITY", "CLOSED"] as const) {
      expect(warningFacts({ ...late, projectPhase: phase }, TODAY)).toEqual([]);
    }
    // Still running, so it still matters.
    expect(warningFacts({ ...late, projectPhase: "AWARDED" }, TODAY)).toHaveLength(1);
  });

  it("fires all three at once when all three are true", () => {
    const facts = warningFacts(
      {
        ...base,
        approvedVariationsTotal: 300_000,
        bondExpiry: "2026-01-31",
        completionDate: "2026-02-28",
      },
      TODAY,
    );
    expect(facts.map((f) => f.key)).toEqual([
      "variationsOverTenPct",
      "bondExpired",
      "completionPast",
    ]);
  });
});

describe("the small arithmetic underneath", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-08-01", "2026-09-19")).toBe(49);
  });

  it("works out an amount from a quantity and a rate", () => {
    const line = toBoqItem({
      id: "1",
      contractId: "2",
      itemNo: "A.01",
      descriptionEl: "Καθαιρέσεις",
      unit: "m3",
      qty: "12.500",
      rate: "40.00",
      amount: "500.00",
    });
    expect(line.qty).toBe(12.5);
    expect(line.amount).toBe(500);
  });

  it("writes money and percentages the way each language does", () => {
    expect(formatEuro(1234567, "el")).toBe("1.234.567 €");
    expect(formatEuro(1234567, "en")).toBe("€1,234,567");
    expect(formatEuro(-2500, "el")).toBe("-2.500 €");
    expect(formatPct(14.25, "el")).toBe("14,3%");
    expect(formatPct(14.25, "en")).toBe("14.3%");
    expect(formatDate("2026-06-30")).toBe("30/06/2026");
  });
});
