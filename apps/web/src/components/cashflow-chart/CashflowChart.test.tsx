import { describe, expect, it } from "vitest";
import type { CashflowRow } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { CashflowChart } from "./CashflowChart";

const rows: CashflowRow[] = [
  { period: "2026-01", planned: 100_000, actual: 90_000, cumulativePlanned: 100_000, cumulativeActual: 90_000 },
  { period: "2026-02", planned: 100_000, actual: 110_000, cumulativePlanned: 200_000, cumulativeActual: 200_000 },
  { period: "2026-03", planned: 100_000, actual: null, cumulativePlanned: 300_000, cumulativeActual: null },
];

describe("CashflowChart", () => {
  it("draws one polyline for the plan and at least one for actual, in the right colours", () => {
    renderWithIntl(<CashflowChart rows={rows} />);
    const planned = document.querySelector('polyline[stroke="var(--k-grey)"]');
    const actual = document.querySelector('polyline[stroke="var(--k-blue-deep)"]');
    expect(planned).toBeTruthy();
    expect(actual).toBeTruthy();
  });

  it("never draws a pie chart or canvas — svg polylines only", () => {
    renderWithIntl(<CashflowChart rows={rows} />);
    expect(document.querySelector("canvas")).toBeNull();
    expect(document.querySelectorAll("circle").length + document.querySelectorAll("path").length).toBe(0);
  });

  it("breaks the actual line rather than drawing a false zero for a null cumulative value", () => {
    const withGap: CashflowRow[] = [
      ...rows,
      { period: "2026-04", planned: 100_000, actual: 95_000, cumulativePlanned: 400_000, cumulativeActual: 395_000 },
    ];
    renderWithIntl(<CashflowChart rows={withGap} />);
    // Two segments: [Jan, Feb] then [Apr] alone, since March's actual is null.
    const actualPolylines = document.querySelectorAll('polyline[stroke="var(--k-blue-deep)"]');
    expect(actualPolylines.length).toBe(2);
  });

  it("shows the empty message with no rows", () => {
    renderWithIntl(<CashflowChart rows={[]} />);
    expect(document.querySelector("svg")).toBeNull();
  });

  it("shows a skeleton block while loading", () => {
    renderWithIntl(<CashflowChart rows={[]} state="loading" />);
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy();
  });
});
