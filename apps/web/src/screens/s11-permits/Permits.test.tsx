import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { PermitSystem } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { Permits } from "./Permits";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/permits",
  useSearchParams: () => new URLSearchParams(),
}));

const ROW = {
  id: "p1",
  ref: "PTW-NIC-2026-001",
  orgUnitId: "unit-1",
  projectId: null,
  titleEl: "Διακοπή ρεύματος",
  systems: ["ELECTRICAL"] as PermitSystem[],
  plannedStart: "2026-03-14T08:00:00.000Z",
  plannedEnd: "2026-03-14T16:00:00.000Z",
  status: "APPROVED" as const,
  breachedAt: null,
  icraClass: "IV" as const,
  areaCount: 1,
  highestRiskGroup: "HIGH" as const,
  pendingApprovals: 2,
  orgUnitNameEl: "Νοσοκομείο Λευκωσίας",
};

const NO_FILTERS = { status: [], system: "" as const, unit: "" };

describe("Permits", () => {
  it("renders the export button always, even while loading", () => {
    renderWithIntl(
      <Permits data={undefined} state="loading" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getByRole("button", { name: /Εξαγωγή/ })).toBeInTheDocument();
  });

  it("shows the empty sentence and an add action when there are no permits", () => {
    renderWithIntl(
      <Permits data={{ items: [], total: 0 }} state="empty" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getByText("Δεν υπάρχουν άδειες εργασίας.")).toBeInTheDocument();
  });

  it("renders a permit row with its reference and status", () => {
    renderWithIntl(
      <Permits data={{ items: [ROW], total: 1 }} state="default" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getAllByText("PTW-NIC-2026-001").length).toBeGreaterThan(0);
  });

  it("renders noPermission instead of the table", () => {
    renderWithIntl(
      <Permits data={undefined} state="noPermission" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} noPermission={<p>no-permission-marker</p>} />,
    );
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });
});
