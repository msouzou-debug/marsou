import { describe, expect, it } from "vitest";
import { addMonths, backlogRows, handoverDueDate } from "./defect-rows";

/**
 * R12 and R35 — the defects-liability arithmetic and the backlog banding,
 * tested as what they are: functions of a row. No database and no clock.
 */
describe("handoverDueDate", () => {
  it("is completion + extensions + the liability months", () => {
    // A contract finishing on 30/06/2026, no extension, twelve months of
    // defects liability: the period runs to 30/06/2027.
    expect(handoverDueDate("2026-06-30", 0, 12)).toBe("2027-06-30");
  });

  it("counts the extension days first, because they move completion itself", () => {
    // Thirty days late finishing means thirty days later out of liability.
    expect(handoverDueDate("2026-06-30", 30, 12)).toBe("2027-07-30");
    expect(handoverDueDate("2026-06-30", 45, 6)).toBe("2027-02-14");
  });

  it("adds calendar months, not thirty-day blocks", () => {
    // Six months from the end of August is the end of February, and February
    // is short: the day is clamped rather than spilling into March.
    expect(handoverDueDate("2026-08-31", 0, 6)).toBe("2027-02-28");
    expect(handoverDueDate("2027-08-31", 0, 6)).toBe("2028-02-29"); // leap year
    expect(handoverDueDate("2026-01-31", 0, 1)).toBe("2026-02-28");
  });

  it("is null where there is nothing to count from", () => {
    // A contract with no completion date has no liability period to end.
    expect(handoverDueDate(null, 0, 12)).toBeNull();
  });

  it("is the completion date itself where there is no liability period", () => {
    expect(handoverDueDate("2026-06-30", 0, 0)).toBe("2026-06-30");
  });
});

describe("addMonths", () => {
  it("crosses years without drifting", () => {
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-12-15", 24)).toBe("2028-12-15");
    expect(addMonths("2026-03-15", 0)).toBe("2026-03-15");
  });
});

describe("backlogRows", () => {
  const defects = [
    { orgUnitId: "nicosia-general", riskBand: "HIGH" as const, estimatedCost: 10_000, funded: true },
    { orgUnitId: "nicosia-general", riskBand: "HIGH" as const, estimatedCost: 5_000, funded: false },
    { orgUnitId: "nicosia-general", riskBand: "LOW" as const, estimatedCost: 800, funded: false },
    { orgUnitId: "larnaca-general", riskBand: "MODERATE" as const, estimatedCost: "2500.50", funded: false },
  ];

  it("groups by unit and band, worst band first inside a unit", () => {
    const rows = backlogRows(defects);
    expect(rows.map((r) => [r.orgUnitId, r.riskBand])).toEqual([
      ["larnaca-general", "MODERATE"],
      ["nicosia-general", "HIGH"],
      ["nicosia-general", "LOW"],
    ]);
  });

  it("splits the cost into funded and unfunded, and the two add up to the total", () => {
    const high = backlogRows(defects).find((r) => r.riskBand === "HIGH");
    expect(high).toMatchObject({ count: 2, estimatedCost: 15_000, funded: 10_000, unfunded: 5_000 });
    for (const row of backlogRows(defects)) {
      expect(row.funded + row.unfunded).toBe(row.estimatedCost);
    }
  });

  it("counts a defect nobody has priced without pretending it costs nothing", () => {
    // RULE (R35): leaving it out of the count would hide it; calling it zero
    // would understate the backlog. It counts, and it adds no money.
    const rows = backlogRows([
      { orgUnitId: "troodos", riskBand: "HIGH", estimatedCost: null, funded: false },
      { orgUnitId: "troodos", riskBand: "HIGH", estimatedCost: 1_200, funded: false },
    ]);
    expect(rows).toEqual([
      {
        orgUnitId: "troodos",
        riskBand: "HIGH",
        count: 2,
        estimatedCost: 1_200,
        funded: 0,
        unfunded: 1_200,
      },
    ]);
  });

  it("reads numeric out of pg as a number, not a string", () => {
    const row = backlogRows(defects).find((r) => r.orgUnitId === "larnaca-general");
    expect(row?.estimatedCost).toBe(2500.5);
  });

  it("has nothing to say about an empty backlog", () => {
    expect(backlogRows([])).toEqual([]);
  });
});
