import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
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
  sapAssetClass: "111042",
  sapAssetClassNameEl: "Κλιματισμός",
  sapAssetClassNameEn: "Air-conditioning",
  priorityRank: 3,
};

const NO_FILTERS = {
  unit: "",
  areaId: "",
  assetClass: "" as const,
  criticality: 0 as const,
  condition: "" as const,
  status: "" as const,
  sapAssetClass: "",
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

  // Owner decision 25/11/2026: one register, every SAP class.
  const SAP_CLASSES = [
    { code: "111030", nameEl: "Ιατρικός εξοπλισμός", nameEn: "Medical Equipment", active: true },
    { code: "111042", nameEl: "Κλιματισμός", nameEn: "Air-conditioning", active: true },
  ];

  it("shows the SAP class as «code — name», and a dash for an asset with none", () => {
    renderWithIntl(
      <Assets
        data={{ items: [ROW, { ...ROW, id: "a2", tag: "NGH-OTH-0002", sapAssetClass: null, sapAssetClassNameEl: null, sapAssetClassNameEn: null }], total: 2 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={vi.fn()}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
        sapClasses={SAP_CLASSES}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Κατηγορία SAP/ });
    const columnIndex = Array.from(header.parentElement!.children).indexOf(header);
    const rowOf = (tag: string) =>
      screen.getAllByText(tag).map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null)!;
    expect(rowOf("NGH-HVAC-0001").children[columnIndex].textContent).toBe("111042 — Κλιματισμός");
    expect(rowOf("NGH-OTH-0002").children[columnIndex].textContent).toBe("—");
  });

  it("filters by SAP class, including the assets with none", () => {
    const onFilters = vi.fn();
    renderWithIntl(
      <Assets
        data={{ items: [ROW], total: 1 }}
        state="default"
        filters={NO_FILTERS}
        orgUnits={[]}
        onFilters={onFilters}
        canWrite={true}
        canViewForecast={false}
        noPermission={<div />}
        sapClasses={SAP_CLASSES}
      />,
    );
    const select = screen.getByLabelText("Κατηγορία παγίου SAP");
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent)).toEqual([
      "Όλα",
      "111030 — Ιατρικός εξοπλισμός",
      "111042 — Κλιματισμός",
      "Χωρίς κατηγορία SAP",
    ]);
    fireEvent.change(select, { target: { value: "111030" } });
    expect(onFilters).toHaveBeenCalledWith({ ...NO_FILTERS, sapAssetClass: "111030" });
    fireEvent.change(select, { target: { value: "NONE" } });
    expect(onFilters).toHaveBeenCalledWith({ ...NO_FILTERS, sapAssetClass: "NONE" });
  });
});
