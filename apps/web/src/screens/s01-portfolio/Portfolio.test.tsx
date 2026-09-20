import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import type { OrgUnit, PortfolioResponse } from "@ecapital/shared";
import { Portfolio } from "./Portfolio";

// UnitTable calls useRouter() for the unit link / row-click navigation.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function ramp(total: number): number[] {
  return Array.from({ length: 12 }, (_, i) => Math.round((total * (i + 1)) / 12));
}

function unit(id: string, code: string, nameEl: string, directorate: OrgUnit["directorate"]): OrgUnit {
  return {
    id,
    code,
    nameEl,
    nameEn: nameEl,
    type: "HOSPITAL",
    directorate,
    costCentre: null,
    entityCode: null,
    efinanceCode: null,
    timezone: "Europe/Nicosia",
  };
}

// Deliberately *not* sorted by approved budget, so the default-sort
// assertion actually exercises something (UI instructions §5).
const units: PortfolioResponse["units"] = [
  {
    orgUnit: unit("unit-a", "A", "Μονάδα Α", "LEFKOSIAS"),
    projectCount: 3,
    approved: 500_000,
    spent: 300_000,
    sparkline: { plan: ramp(500_000), spend: ramp(300_000) },
    rag: { green: 2, amber: 1, red: 0 },
  },
  {
    orgUnit: unit("unit-b", "B", "Μονάδα Β", "LARNAKAS_AMMOCHOSTOU"),
    projectCount: 5,
    approved: 1_200_000,
    spent: 800_000,
    sparkline: { plan: ramp(1_200_000), spend: ramp(800_000) },
    rag: { green: 3, amber: 1, red: 1 },
  },
  {
    orgUnit: unit("unit-c", "C", "Μονάδα Γ", "LEFKOSIAS"),
    projectCount: 4,
    approved: 800_000,
    spent: 750_000,
    sparkline: { plan: ramp(800_000), spend: ramp(750_000) },
    rag: { green: 2, amber: 2, red: 0 },
  },
  {
    orgUnit: unit("unit-d", "D", "Μονάδα Δ", "PFY"),
    projectCount: 2,
    approved: 300_000,
    spent: 100_000,
    sparkline: { plan: ramp(300_000), spend: ramp(100_000) },
    rag: { green: 2, amber: 0, red: 0 },
  },
];

function fixture(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    kpis: { approved: 2_800_000, committed: 2_200_000, spent: 1_950_000, forecast: 2_900_000, yearElapsedPct: 62 },
    units,
    exceptions: [],
    asOf: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

const noPermission = <div data-testid="no-permission-stub" />;

describe("Portfolio KPI row", () => {
  it("shows the % of year elapsed as every tile's comparator", () => {
    renderWithIntl(<Portfolio data={fixture()} state="default" noPermission={noPermission} />);
    const comparators = screen.getAllByText(/% έτους που έχει παρέλθει/);
    // RULE: all four ledgers compare against time, not only against the plan.
    expect(comparators).toHaveLength(4);
    expect(comparators[0].textContent).toMatch(/62,0/);
  });
});

describe("Portfolio exceptions list", () => {
  it("renders the never-empty sentence instead of an empty card", () => {
    renderWithIntl(<Portfolio data={fixture({ exceptions: [] })} state="default" noPermission={noPermission} />);
    expect(screen.getByText("Δεν υπάρχουν θέματα που χρειάζονται προσοχή.")).toBeInTheDocument();
  });

  it("renders each exception's sentence and link when there are some", () => {
    renderWithIntl(
      <Portfolio
        data={fixture({
          exceptions: [
            {
              id: "EXC-1",
              projectId: "P-1",
              orgUnitId: "unit-b",
              sentenceEl: "Οι δεσμεύσεις υπερβαίνουν τον προϋπολογισμό — Μονάδα Β",
              sentenceEn: "Commitments exceed the budget — Unit B",
              severity: "red",
              href: "/projects/P-1",
            },
          ],
        })}
        state="default"
        noPermission={noPermission}
      />,
    );
    const sentence = screen.getByText(/Οι δεσμεύσεις υπερβαίνουν τον προϋπολογισμό/);
    expect(sentence.closest("a")).toHaveAttribute("href", "/projects/P-1");
  });
});

describe("Portfolio unit table", () => {
  it("sorts by approved budget descending by default", () => {
    renderWithIntl(<Portfolio data={fixture()} state="default" noPermission={noPermission} />);
    const rows = document.querySelectorAll("tbody tr");
    const names = Array.from(rows).map((row) => row.querySelector("a")?.textContent);
    expect(names).toEqual(["Μονάδα Β", "Μονάδα Γ", "Μονάδα Α", "Μονάδα Δ"]);
  });

  it("shows the export button", () => {
    renderWithIntl(<Portfolio data={fixture()} state="default" noPermission={noPermission} />);
    expect(screen.getByRole("button", { name: "Εξαγωγή σε Excel" })).toBeInTheDocument();
  });

  it("renders «—», never «0 €», for a unit row whose spent is null (CAPEX-01 §7)", () => {
    const withNullSpent = fixture({
      units: units.map((u, i) => (i === 0 ? { ...u, spent: null } : u)),
    });
    renderWithIntl(<Portfolio data={withNullSpent} state="default" noPermission={noPermission} />);
    const row = screen.getByText("Μονάδα Α").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("—")).toBeInTheDocument();
    expect(within(row!).queryByText("0 €")).not.toBeInTheDocument();
  });

  it("gives every numeric cell the num class", () => {
    renderWithIntl(<Portfolio data={fixture()} state="default" noPermission={noPermission} />);
    // Έργα, Εγκεκριμένος and Δαπάνες are numeric for all four unit rows.
    const numericCells = document.querySelectorAll("td.num");
    expect(numericCells.length).toBeGreaterThanOrEqual(units.length * 3);
    numericCells.forEach((cell) => expect(cell).toHaveClass("num"));
  });

  it("groups by directorate with a subheader and correct subtotals when turned on", () => {
    renderWithIntl(<Portfolio data={fixture()} state="default" noPermission={noPermission} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Ομαδοποίηση κατά Διεύθυνση" }));

    // One subheader per directorate present among the four fixture units.
    expect(screen.getByText("Λευκωσίας")).toBeInTheDocument();
    expect(screen.getByText("Λάρνακας–Αμμοχώστου")).toBeInTheDocument();
    expect(screen.getByText("Πρωτοβάθμια Φροντίδα Υγείας")).toBeInTheDocument();

    // Λευκωσίας subtotal: unit A (500.000 / 300.000, 3 projects) + unit C
    // (800.000 / 750.000, 4 projects) = 7 projects, 1.300.000 €, 1.050.000 €.
    const lefkosiasHeader = screen.getByText("Λευκωσίας").closest("tr");
    const subtotalRow = lefkosiasHeader?.parentElement
      ? Array.from(lefkosiasHeader.parentElement.querySelectorAll("tr")).find(
          (row) => row !== lefkosiasHeader && row.textContent?.includes("Σύνολο") && row.textContent.includes("7"),
        )
      : undefined;
    expect(subtotalRow).toBeTruthy();
    expect(within(subtotalRow!).getByText("1.300.000 €")).toBeInTheDocument();
    expect(within(subtotalRow!).getByText("1.050.000 €")).toBeInTheDocument();
  });
});
