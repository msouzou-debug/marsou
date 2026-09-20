import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { Forecast } from "./Forecast";

const ROWS = [
  { orgUnitId: "u1", orgUnitNameEl: "Νοσοκομείο Λευκωσίας", year: 2026, assets: 3, estimatedCost: 100_000, criticalAssets: 1 },
  { orgUnitId: "u1", orgUnitNameEl: "Νοσοκομείο Λευκωσίας", year: 2027, assets: 2, estimatedCost: 50_000, criticalAssets: 0 },
  { orgUnitId: "u2", orgUnitNameEl: "Νοσοκομείο Λάρνακας", year: 2026, assets: 1, estimatedCost: 20_000, criticalAssets: 1 },
];

describe("Forecast", () => {
  it("shows a bold totals row summing every unit and year in view", () => {
    renderWithIntl(
      <Forecast rows={ROWS} state="default" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<div />} />,
    );
    const totalsRow = screen.getByText("Σύνολο").closest("tr")!;
    expect(totalsRow.textContent).toContain("6"); // total assets 3+2+1
    expect(totalsRow.textContent).toContain("2"); // total critical assets 1+0+1
  });

  it("shows the empty sentence with no rows", () => {
    renderWithIntl(
      <Forecast rows={[]} state="empty" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getByText("Δεν υπάρχουν πάγια με προγραμματισμένη αντικατάσταση σε αυτό το διάστημα.")).toBeInTheDocument();
  });

  it("renders noPermission instead of the table", () => {
    renderWithIntl(
      <Forecast rows={undefined} state="noPermission" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<p>no-permission-marker</p>} />,
    );
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });

  it("renders the export button always, even while loading", () => {
    renderWithIntl(
      <Forecast rows={undefined} state="loading" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getByRole("button", { name: /Εξαγωγή/ })).toBeInTheDocument();
  });
});
