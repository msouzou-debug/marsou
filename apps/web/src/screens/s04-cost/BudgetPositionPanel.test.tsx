import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { buildBudgetPosition, buildProjectBudgetPosition } from "@/mocks/efinance";
import { BudgetPositionPanel } from "./BudgetPositionPanel";
import { Cost } from "./Cost";
import { buildBudgetLines, buildCashflowRows, buildProjectCost } from "./fixture";

const eur = (value: number) => formatEUR(value).replace(/\s/g, " ");

describe("BudgetPositionPanel", () => {
  it("shows one card per budget code and year with the five figures and the as-of time", () => {
    renderWithIntl(<BudgetPositionPanel data={buildProjectBudgetPosition()} state="default" />);
    const rows = screen.getAllByTestId("budget-position-row");
    expect(rows).toHaveLength(2);

    const first = rows[0];
    expect(within(first).getByText("7402")).toBeInTheDocument();
    expect(within(first).getByText("2026")).toBeInTheDocument();
    for (const label of ["Προϋπολογισμός", "Δαπάνες", "Δεσμεύσεις eFinance", "Σε εξέλιξη", "Διαθέσιμο"]) {
      expect(within(first).getByText(label)).toBeInTheDocument();
    }
    expect(within(first).getByTestId("bp-allocated")).toHaveTextContent(eur(3_000_000));
    expect(within(first).getByTestId("bp-booked")).toHaveTextContent(eur(480_000));
    expect(within(first).getByTestId("bp-requisitions")).toHaveTextContent(eur(240_000));
    expect(within(first).getByTestId("bp-in-flight")).toHaveTextContent(eur(96_000));
    expect(within(first).getByTestId("bp-available")).toHaveTextContent(eur(2_280_000));
    // 06:30 UTC on 02/10/2026 is 09:30 in Nicosia.
    expect(within(first).getByText(/Στοιχεία eFinance έως 02\/10\/2026\s09:30/)).toBeInTheDocument();
  });

  it("renders null figures as dashes, never 0", () => {
    renderWithIntl(<BudgetPositionPanel data={buildProjectBudgetPosition()} state="default" />);
    const second = screen.getAllByTestId("budget-position-row")[1];
    expect(within(second).getByTestId("bp-allocated")).toHaveTextContent(eur(500_000));
    for (const id of ["bp-booked", "bp-requisitions", "bp-in-flight", "bp-available"]) {
      expect(within(second).getByTestId(id)).toHaveTextContent(/^—$/);
    }
  });

  // RULE: in flight is shown and marked, never counted.
  it("marks «Σε εξέλιξη» as not counted, once per card", () => {
    renderWithIntl(<BudgetPositionPanel data={buildProjectBudgetPosition()} state="default" />);
    expect(screen.getAllByText("Δεν προσμετράται")).toHaveLength(2);
  });

  it("shows a negative availability in red", () => {
    const data = { configured: true, items: [buildBudgetPosition({ available: -5_000 })] };
    renderWithIntl(<BudgetPositionPanel data={data} state="default" />);
    expect(screen.getByTestId("bp-available").querySelector("span")).toHaveClass("text-k-red");
  });

  it("carries a one-line caption saying it is eFinance's view and not in the cost ledgers", () => {
    renderWithIntl(<BudgetPositionPanel data={buildProjectBudgetPosition()} state="default" />);
    expect(screen.getByText(/Η εικόνα του eFinance ανά κωδικό προϋπολογισμού\. Δεν προστίθεται στις τέσσερις στήλες του κόστους του έργου\./)).toBeInTheDocument();
  });

  it("shows the quiet not-configured line, and no cards", () => {
    renderWithIntl(<BudgetPositionPanel data={{ configured: false, items: [] }} state="default" />);
    expect(screen.getByText("Δεν έχει ρυθμιστεί η σύνδεση με το eFinance")).toBeInTheDocument();
    expect(screen.queryByTestId("budget-position-row")).not.toBeInTheDocument();
  });

  it("explains a configured project with no budget codes", () => {
    renderWithIntl(<BudgetPositionPanel data={{ configured: true, items: [] }} state="default" />);
    expect(screen.getByText(/δεν έχουν ακόμη κωδικό προϋπολογισμού/)).toBeInTheDocument();
  });

  it("shows an error with a retry when eFinance did not answer", () => {
    const onRetry = vi.fn();
    renderWithIntl(<BudgetPositionPanel state="error" onRetry={onRetry} />);
    expect(screen.getByText("Το eFinance δεν απάντησε. Δοκιμάστε ξανά σε λίγο.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Δοκιμάστε ξανά" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows a skeleton while loading", () => {
    const { container } = renderWithIntl(<BudgetPositionPanel state="loading" />);
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
  });

  it("speaks English too", () => {
    renderWithIntl(<BudgetPositionPanel data={buildProjectBudgetPosition()} state="default" />, { locale: "en" });
    expect(screen.getByText("eFinance budget position")).toBeInTheDocument();
    expect(screen.getAllByText("Not counted")).toHaveLength(2);
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });
});

describe("Cost — the panel sits beside the CostBar, not in it", () => {
  const noop = () => undefined;
  const base = {
    projectId: "p-1",
    projectTitle: "Ανακαίνιση",
    projectCode: "PRJ-031",
    noPermission: <div />,
    onDismissWarning: noop,
    onSaveForecastInputs: noop,
    onExport: noop,
    cashflowRows: buildCashflowRows(),
    cashflowState: "default" as const,
    cashflowFrom: "2026-01",
    cashflowTo: "2026-12",
    onCashflowRangeChange: noop,
    budgetLines: buildBudgetLines(),
    budgetYear: 2026,
    onBudgetYearChange: noop,
    onSaveBudgetLines: noop,
  };

  it("renders the panel in its own section, outside the CostBar", () => {
    renderWithIntl(
      <Cost {...base} data={buildProjectCost()} state="default" budgetPosition={buildProjectBudgetPosition()} budgetPositionState="default" />,
    );
    const panel = screen.getByRole("heading", { name: "Θέση προϋπολογισμού στο eFinance" }).closest("section") as HTMLElement;
    expect(panel).toBeInTheDocument();
    // eFinance's booked figure is in the panel only.
    expect(within(panel).getAllByTestId("bp-booked")).toHaveLength(2);
    expect(screen.getAllByText(eur(480_000))).toHaveLength(1);
  });

  it("does not mount the panel when the screen was not given its state", () => {
    renderWithIntl(<Cost {...base} data={buildProjectCost()} state="default" />);
    expect(screen.queryByText("Θέση προϋπολογισμού στο eFinance")).not.toBeInTheDocument();
  });
});
