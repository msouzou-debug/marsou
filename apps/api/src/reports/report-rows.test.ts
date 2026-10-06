import type { ExceptionRow } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { parseReportQuery, quarterOf } from "./report-query";
import {
  assetLifecycleRow,
  capitalContractorRow,
  isHighRisk,
  milestoneLateDays,
  monthsOf,
  sortExceptions,
  sortLifecycle,
  sumComplete,
  sumKnown,
  yearElapsedFor,
} from "./report-rows";

const NOW = new Date("2026-10-06T09:00:00.000Z");

describe("report query", () => {
  it("defaults the year to this one and the period to this quarter", () => {
    expect(parseReportQuery({}, NOW)).toEqual({
      orgUnitId: null,
      year: 2026,
      from: "2026-10-01",
      to: "2027-01-01",
    });
  });

  it("coerces the year and completes a half-given period from its quarter", () => {
    expect(parseReportQuery({ year: "2025", from: "2026-02-10" }, NOW)).toMatchObject({
      year: 2025,
      from: "2026-02-10",
      to: "2026-04-01",
    });
    expect(parseReportQuery({ to: "2026-07-01" }, NOW)).toMatchObject({ from: "2026-04-01", to: "2026-07-01" });
  });

  it("refuses a year out of range, a date that is not one and a period that runs backwards", () => {
    for (const bad of [
      { year: "1999" },
      { year: "2101" },
      { year: "twenty" },
      { from: "2026-02-31" },
      { from: "06/10/2026" },
      { from: "2026-10-01", to: "2026-10-01" },
      { from: "2026-10-02", to: "2026-10-01" },
      { orgUnitId: ["a", "b"] },
    ]) {
      expect(() => parseReportQuery(bad, NOW), JSON.stringify(bad)).toThrow();
    }
  });

  it("knows the quarters", () => {
    expect(quarterOf("2026-03-31")).toEqual({ from: "2026-01-01", to: "2026-04-01" });
    expect(quarterOf("2026-12-01")).toEqual({ from: "2026-10-01", to: "2027-01-01" });
  });
});

describe("capital programme arithmetic", () => {
  it("gives 100 for a past year, 0 for a future one and today's share for this one", () => {
    expect(yearElapsedFor(2025, NOW)).toBe(100);
    expect(yearElapsedFor(2027, NOW)).toBe(0);
    expect(yearElapsedFor(2026, NOW)).toBeCloseTo(76.3, 0);
  });

  it("sums the known ledgers and is null when none is known", () => {
    expect(sumKnown([null, 100, 50.5])).toBe(150.5);
    expect(sumKnown([null, null])).toBeNull();
    expect(sumKnown([])).toBeNull();
  });

  it("gives a forecast only when every project has one", () => {
    expect(sumComplete([100, 200])).toBe(300);
    expect(sumComplete([100, null])).toBeNull();
    expect(sumComplete([])).toBeNull();
  });
});

describe("exceptions", () => {
  it("calls a risk high above 12 of 25", () => {
    expect(isHighRisk(3, 4)).toBe(false);
    expect(isHighRisk(4, 4)).toBe(true);
    expect(isHighRisk(5, 3)).toBe(true);
  });

  it("measures the worst late milestone not yet achieved, forecast before baseline", () => {
    const today = "2026-10-06";
    expect(
      milestoneLateDays(
        [
          { baselineDate: "2026-09-01", forecastDate: "2026-09-26", actualDate: null }, // 10 late
          { baselineDate: "2026-08-01", forecastDate: null, actualDate: null }, // 66 late
          { baselineDate: "2026-01-01", forecastDate: null, actualDate: "2026-02-01" }, // achieved
          { baselineDate: "2026-09-01", forecastDate: "2026-12-01", actualDate: null }, // not yet due
        ],
        today,
      ),
    ).toBe(66);
    expect(
      milestoneLateDays([{ baselineDate: "2026-12-01", forecastDate: null, actualDate: null }], today),
    ).toBeNull();
    expect(milestoneLateDays([], today)).toBeNull();
  });

  it("sorts red first, then amber, then by slippage with none last", () => {
    const row = (code: string, rag: "RED" | "AMBER", slippage: number | null) =>
      ({ projectCode: code, rag, slippage }) as ExceptionRow;
    const sorted = sortExceptions([
      row("A", "AMBER", 500),
      row("B", "RED", null),
      row("C", "RED", 10),
      row("D", "AMBER", null),
      row("E", "AMBER", 900),
    ]);
    expect(sorted.map((r) => r.projectCode)).toEqual(["C", "B", "E", "A", "D"]);
  });
});

describe("capital contractor row (ADR-0032 §5)", () => {
  const base = {
    contractorId: "k",
    contractorName: "Ανάδοχος",
    contracts: 4,
    datedContracts: 4,
    overdueContracts: 1,
    originalValue: 400_000,
    approvedVariations: 20_000,
    contractValue: 420_000,
    defects: 21,
    openDefects: 3,
    rfis: 8,
    rfisLate: 2,
    certificates: 3,
    certifiedClaimed: 90_000,
    certifiedApproved: 60_000,
  };

  it("works every rate out of the counts", () => {
    expect(capitalContractorRow(base)).toMatchObject({
      contracts: 4,
      contractValue: 420_000,
      overdueContracts: 1,
      onTimePct: 75,
      variationRatePct: 5,
      defects: 21,
      openDefects: 3,
      defectRate: 5,
      rfiBreachPct: 25,
      claimAccuracyPct: 66.67,
    });
  });

  it("leaves every rate with nothing under it null, never zero", () => {
    expect(
      capitalContractorRow({
        ...base,
        datedContracts: 0,
        overdueContracts: 0,
        originalValue: 0,
        contractValue: 0,
        rfis: 0,
        rfisLate: 0,
        certificates: 0,
        certifiedClaimed: 0,
        certifiedApproved: 0,
      }),
    ).toMatchObject({
      onTimePct: null,
      variationRatePct: null,
      defectRate: null,
      rfiBreachPct: null,
      claimAccuracyPct: null,
    });
  });

  it("keeps a net omission negative", () => {
    expect(capitalContractorRow({ ...base, approvedVariations: -8_000 }).variationRatePct).toBe(-2);
  });
});

describe("asset lifecycle row", () => {
  const asset = {
    assetId: "a",
    tag: "NGH-WATER-0001",
    nameEl: "Πιεστικό",
    orgUnitId: "nicosia-general",
    orgUnitName: "Γενικό Νοσοκομείο Λευκωσίας",
    assetClass: "WATER",
    criticality: 2,
    condition: "C",
    installedDate: "2016-02-22",
    commissionedDate: "2016-04-11",
    capitalCost: 27_000,
    expectedLifeYears: 15,
    replacementYear: 2028,
    replacementCostEst: 39_000,
  };

  it("works out remaining life against the report year and the cost ratio", () => {
    const row = assetLifecycleRow(asset, { maintenanceCost: 4850, correctiveOrders: 3, downtimeHours: 6.3 }, 2026);
    expect(row).toMatchObject({
      installedYear: 2016,
      remainingLifeYears: 5,
      maintenanceCost: 4850,
      maintenanceToCapitalPct: 17.96,
      correctiveOrders: 3,
      downtimeHours: 6.3,
    });
  });

  it("is null where an input is missing", () => {
    const row = assetLifecycleRow(
      { ...asset, installedDate: null, commissionedDate: null, capitalCost: null },
      { maintenanceCost: 0, correctiveOrders: 0, downtimeHours: 0 },
      2026,
    );
    expect(row).toMatchObject({ installedYear: null, remainingLifeYears: null, maintenanceToCapitalPct: null });
  });

  it("sorts the shortest remaining life first and the unknown last", () => {
    const rows = [
      { tag: "B", remainingLifeYears: null },
      { tag: "A", remainingLifeYears: 7 },
      { tag: "C", remainingLifeYears: -2 },
    ] as Parameters<typeof sortLifecycle>[0];
    expect(sortLifecycle(rows).map((r) => r.tag)).toEqual(["C", "A", "B"]);
  });
});

describe("months", () => {
  it("lists the twelve months of a year", () => {
    expect(monthsOf(2026)).toHaveLength(12);
    expect(monthsOf(2026)[0]).toBe("2026-01");
    expect(monthsOf(2026)[11]).toBe("2026-12");
  });
});
