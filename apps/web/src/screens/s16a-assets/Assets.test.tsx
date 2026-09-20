import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { Assets } from "./Assets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/assets",
  useSearchParams: () => new URLSearchParams(),
}));

const ROW = {
  id: "a1",
  tag: "NGH-HVAC-0001",
  nameEl: "Κλιματιστικό οροφής",
  assetClass: "HVAC" as const,
  criticality: 2,
  condition: "C" as const,
  status: "IN_SERVICE" as const,
  replacementYear: 2030,
  warrantyEnd: "2027-01-01",
  orgUnitId: "unit-1",
  areaId: "area-1",
  areaNameEl: "Θάλαμος 214",
  orgUnitNameEl: "Νοσοκομείο Λευκωσίας",
  priorityRank: 3,
};

const NO_FILTERS = {
  unit: "",
  areaId: "",
  assetClass: "" as const,
  criticality: 0 as const,
  condition: "" as const,
  status: "" as const,
  q: "",
};

describe("Assets", () => {
  it("renders the export button always, even while loading", () => {
    renderWithIntl(
      <Assets data={undefined} state="loading" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} canWrite={true} canViewForecast={false} noPermission={<div />} />,
    );
    expect(screen.getByRole("button", { name: /Εξαγωγή/ })).toBeInTheDocument();
  });

  it("shows the empty sentence and an add action when there are no assets", () => {
    renderWithIntl(
      <Assets
        data={{ items: [], total: 0 }}
        state="empty"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
      />,
    );
    expect(screen.getByText("Δεν υπάρχουν καταχωρισμένα πάγια.")).toBeInTheDocument();
  });

  it("renders an asset row with its tag, criticality and condition chips", () => {
    renderWithIntl(
      <Assets
        data={{ items: [ROW], total: 1 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
      />,
    );
    expect(screen.getAllByText("NGH-HVAC-0001").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Κρισιμότητα 2").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Φυσική κατάσταση C — μέτρια").length).toBeGreaterThan(0);
  });

  it("renders noPermission instead of the table", () => {
    renderWithIntl(
      <Assets data={undefined} state="noPermission" filters={NO_FILTERS} orgUnits={[]} onFilters={vi.fn()} canWrite={true} canViewForecast={false} noPermission={<p>no-permission-marker</p>} />,
    );
    expect(screen.getByText("no-permission-marker")).toBeInTheDocument();
  });

  it("hides «Προσθήκη» when the caller cannot write assets", () => {
    renderWithIntl(
      <Assets
        data={{ items: [ROW], total: 1 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={false}
        canViewForecast={false}
        noPermission={<div />}
      />,
    );
    expect(screen.queryByRole("link", { name: "Προσθήκη" })).not.toBeInTheDocument();
  });

  // RULE (build brief item 1): the «Προτεραιότητα» column sorts by the API's
  // own `priorityRank`, and a null rank never sorts as if it were the most
  // urgent (0) — it is mapped to +Infinity so it always sorts last.
  it("shows a dash, never 0, for a row with no computed priority rank", () => {
    renderWithIntl(
      <Assets
        data={{ items: [{ ...ROW, priorityRank: null }], total: 1 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
      />,
    );
    const priorityHeader = screen.getByRole("columnheader", { name: /Προτεραιότητα/ });
    const columnIndex = Array.from(priorityHeader.parentElement!.children).indexOf(priorityHeader);
    // Both the phone cards and the table render the tag; only the table's own copy sits in a <tr>.
    const row = screen.getAllByText("NGH-HVAC-0001").map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null)!;
    expect(row.children[columnIndex].textContent).toBe("—");
  });

  // RULE (build brief item 1): the label-print control has a stable position —
  // disabled with a reason, never removed — until a row is selected.
  it("disables «Εκτύπωση ετικετών» with no row selected", () => {
    renderWithIntl(
      <Assets
        data={{ items: [ROW], total: 1 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
      />,
    );
    expect(screen.queryByRole("link", { name: /Εκτύπωση ετικετών/ })).not.toBeInTheDocument();
    expect(screen.getByTitle("Εκτύπωση ετικετών")).toBeInTheDocument();
  });
});
