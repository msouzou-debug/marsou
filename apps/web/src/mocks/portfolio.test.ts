import { OrgUnit, PortfolioResponse, ProjectSummary } from "@ecapital/shared";
import { describe, expect, it } from "vitest";
import { orgUnits } from "./org-units";
import { buildPortfolio } from "./portfolio";
import { projects } from "./projects";

const ASOF = new Date("2026-09-18T00:00:00Z");

describe("buildPortfolio", () => {
  it("returns at most eight exceptions", () => {
    const result = buildPortfolio(ASOF);
    expect(result.exceptions.length).toBeLessThanOrEqual(8);
  });

  it("sums KPI totals from the project ledgers", () => {
    const result = buildPortfolio(ASOF);
    const expected = projects.reduce(
      (acc, p) => ({
        approved: acc.approved + p.ledgers.approved,
        committed: acc.committed + p.ledgers.committed,
        spent: acc.spent + p.ledgers.spent,
        forecast: acc.forecast + p.ledgers.forecast,
      }),
      { approved: 0, committed: 0, spent: 0, forecast: 0 },
    );
    expect(result.kpis.approved).toBe(expected.approved);
    expect(result.kpis.committed).toBe(expected.committed);
    expect(result.kpis.spent).toBe(expected.spent);
    expect(result.kpis.forecast).toBe(expected.forecast);
  });

  it("only lists seeded org units", () => {
    const result = buildPortfolio(ASOF);
    const seededIds = new Set(orgUnits.map((u) => u.id));
    expect(result.units.length).toBe(orgUnits.length);
    for (const row of result.units) {
      expect(seededIds.has(row.orgUnit.id)).toBe(true);
    }
  });

  it("every project's orgUnitId resolves to a seeded unit", () => {
    const seededIds = new Set(orgUnits.map((u) => u.id));
    for (const p of projects) {
      expect(seededIds.has(p.orgUnitId)).toBe(true);
    }
  });

  it("accepts the fixtures through the shared zod schemas", () => {
    expect(() => PortfolioResponse.parse(buildPortfolio(ASOF))).not.toThrow();
    expect(() => OrgUnit.array().parse(orgUnits)).not.toThrow();
    expect(() => ProjectSummary.array().parse(projects)).not.toThrow();
  });

  it("computes yearElapsedPct at about 50 for 2026-07-02", () => {
    const result = buildPortfolio(new Date("2026-07-02T00:00:00Z"));
    expect(result.kpis.yearElapsedPct).toBeGreaterThan(48);
    expect(result.kpis.yearElapsedPct).toBeLessThan(52);
  });
});
