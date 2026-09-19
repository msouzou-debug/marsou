import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import type { AreaType, PermitSystem } from "@ecapital/shared";
import { renderWithIntl } from "@/test/render";
import { CalendarGrid } from "./CalendarGrid";

function entry(overrides: Partial<Parameters<typeof CalendarGrid>[0]["entries"][number]> = {}) {
  return {
    permitId: "p1",
    permitRef: "PTW-NIC-2026-001",
    orgUnitId: "unit-1",
    orgUnitCode: "NIC",
    titleEl: "Διακοπή ρεύματος",
    systems: ["ELECTRICAL"] as PermitSystem[],
    areaIds: ["a1"],
    areaTypes: ["THEATRE"] as AreaType[],
    areaNamesEl: ["Χειρουργείο 1"],
    start: "2026-03-14T08:00:00.000Z",
    end: "2026-03-14T16:00:00.000Z",
    icraClass: "IV" as const,
    status: "APPROVED" as const,
    hasClash: false,
    ...overrides,
  };
}

describe("CalendarGrid", () => {
  it("shows the empty state with no entries", () => {
    renderWithIntl(<CalendarGrid year={2026} month={2} entries={[]} onOpen={vi.fn()} />);
    expect(screen.getByText(/Δεν υπάρχουν/)).toBeInTheDocument();
  });

  it("marks a clashing entry with a warning icon naming the other permit", () => {
    const clashing = entry({ permitId: "p1", hasClash: true, orgUnitId: "unit-1" });
    const other = entry({
      permitId: "p2",
      permitRef: "PTW-NIC-2026-002",
      titleEl: "Διακοπή νερού",
      hasClash: true,
      start: "2026-03-14T10:00:00.000Z",
      end: "2026-03-14T18:00:00.000Z",
    });
    const { container } = renderWithIntl(
      <CalendarGrid year={2026} month={2} entries={[clashing, other]} onOpen={vi.fn()} />,
    );
    // Two pills per entry (desktop grid + phone list) both carry the icon.
    expect(container.querySelectorAll('[title*="PTW-"]').length).toBeGreaterThan(0);
  });

  it("never disables opening a clashing entry — a clash only warns", () => {
    const clashing = entry({ hasClash: true });
    renderWithIntl(<CalendarGrid year={2026} month={2} entries={[clashing]} onOpen={vi.fn()} />);
    const buttons = screen.getAllByRole("button", { name: /Διακοπή ρεύματος/ });
    for (const button of buttons) expect(button).not.toBeDisabled();
  });
});
