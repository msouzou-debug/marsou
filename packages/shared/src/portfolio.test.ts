import { describe, expect, it } from "vitest";
import { Exception, PortfolioResponse } from "./portfolio";

const orgUnit = {
  id: "nicosia-general",
  code: "NGH",
  nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
  nameEn: "Nicosia General Hospital",
  type: "HOSPITAL",
  directorate: "LEFKOSIAS",
  costCentre: "CC-NGH-01",
  timezone: "Europe/Nicosia",
};

describe("PortfolioResponse", () => {
  it("accepts a well-formed response", () => {
    const response = {
      kpis: { approved: 100, committed: 80, spent: 40, forecast: 90, yearElapsedPct: 50 },
      units: [
        {
          orgUnit,
          projectCount: 1,
          approved: 100,
          spent: 40,
          sparkline: { plan: Array(12).fill(0), spend: Array(12).fill(0) },
          rag: { green: 1, amber: 0, red: 0 },
        },
      ],
      exceptions: [],
      asOf: new Date().toISOString(),
    };
    expect(() => PortfolioResponse.parse(response)).not.toThrow();
  });

  it("rejects more than eight exceptions", () => {
    const exception: Exception = {
      id: "EXC-1",
      projectId: "PRJ-1",
      orgUnitId: "nicosia-general",
      sentenceEl: "Παράδειγμα",
      sentenceEn: "Example",
      severity: "amber",
      href: "/projects/PRJ-1",
    };
    const response = {
      kpis: { approved: 0, committed: 0, spent: 0, forecast: 0, yearElapsedPct: 0 },
      units: [],
      exceptions: Array(9).fill(exception),
      asOf: new Date().toISOString(),
    };
    expect(() => PortfolioResponse.parse(response)).toThrow();
  });

  it("rejects a sparkline with the wrong number of points", () => {
    const response = {
      kpis: { approved: 0, committed: 0, spent: 0, forecast: 0, yearElapsedPct: 0 },
      units: [
        {
          orgUnit,
          projectCount: 0,
          approved: 0,
          spent: 0,
          sparkline: { plan: [1, 2, 3], spend: Array(12).fill(0) },
          rag: { green: 0, amber: 0, red: 0 },
        },
      ],
      exceptions: [],
      asOf: new Date().toISOString(),
    };
    expect(() => PortfolioResponse.parse(response)).toThrow();
  });
});
