import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "@/test/render";
import { Forecast } from "./Forecast";

const exportTable = vi.fn().mockResolvedValue(undefined);
vi.mock("@/components/table", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/table")>()),
  exportTable: (...args: unknown[]) => exportTable(...args),
}));

const SAP = { sapAssetClass: "111042", sapAssetClassNameEl: "Κλιματισμός", sapAssetClassNameEn: "Air-conditioning" };
const NO_SAP = { sapAssetClass: null, sapAssetClassNameEl: null, sapAssetClassNameEn: null };

const ROWS = [
  { orgUnitId: "u1", orgUnitNameEl: "Νοσοκομείο Λευκωσίας", ...SAP, year: 2026, assets: 3, estimatedCost: 100_000, criticalAssets: 1 },
  { orgUnitId: "u1", orgUnitNameEl: "Νοσοκομείο Λευκωσίας", ...SAP, year: 2027, assets: 2, estimatedCost: 50_000, criticalAssets: 0 },
  { orgUnitId: "u2", orgUnitNameEl: "Νοσοκομείο Λάρνακας", ...SAP, year: 2026, assets: 1, estimatedCost: 20_000, criticalAssets: 1 },
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

  // Owner decision 25/11/2026: the forecast carries SAP's class.
  it("shows the SAP class on every row, the unclassed last in their year", () => {
    const rows = [
      { orgUnitId: "u1", orgUnitNameEl: "Νοσοκομείο Λευκωσίας", ...NO_SAP, year: 2026, assets: 1, estimatedCost: 5_000, criticalAssets: 0 },
      ...ROWS,
    ];
    renderWithIntl(
      <Forecast rows={rows} state="default" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<div />} />,
    );
    expect(screen.getByRole("columnheader", { name: "Κατηγορία παγίου SAP" })).toBeInTheDocument();
    const body = screen.getAllByRole("row").slice(1, -1).map((tr) => tr.textContent ?? "");
    // Λάρνακα first (alphabetical), then Λευκωσία 2026 SAP, 2026 none, 2027 SAP.
    expect(body[0]).toContain("111042 — Κλιματισμός");
    expect(body[1]).toContain("Νοσοκομείο Λευκωσίας2026111042 — Κλιματισμός");
    expect(body[2]).toContain("Χωρίς κατηγορία SAP");
    expect(body[3]).toContain("2027");
  });

  it("exports the table as shown, SAP class included", async () => {
    exportTable.mockClear();
    renderWithIntl(
      <Forecast rows={ROWS} state="default" from={2026} to={2030} onRangeChange={vi.fn()} unit="" orgUnits={[]} onUnitChange={vi.fn()} noPermission={<div />} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Εξαγωγή/ }));
    expect(exportTable).toHaveBeenCalledTimes(1);
    const input = exportTable.mock.calls[0][0] as {
      columns: { id: string; accessor: (row: (typeof ROWS)[number]) => unknown }[];
      rows: typeof ROWS;
    };
    expect(input.columns.map((c) => c.id)).toEqual(["unit", "year", "sapClass", "assets", "estimatedCost", "criticalAssets"]);
    const sapColumn = input.columns.find((c) => c.id === "sapClass")!;
    expect(sapColumn.accessor(input.rows[0])).toBe("111042 — Κλιματισμός");
  });
});
