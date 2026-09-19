import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render";
import { formatEUR } from "@/lib/format";
import { Cost } from "./Cost";
import { buildProjectCost } from "./fixture";

const noPermission = <div>δεν έχετε πρόσβαση (test placeholder)</div>;
const noop = () => undefined;

const baseProps = {
  projectId: "p-1",
  noPermission,
  onDismissWarning: noop,
  onSaveForecastInputs: noop,
  onExport: noop,
  cashflowState: "default" as const,
  cashflowFrom: "2026-01",
  cashflowTo: "2026-12",
  onCashflowRangeChange: noop,
  budgetYear: 2026,
  onBudgetYearChange: noop,
  onSaveBudgetLines: noop,
};

describe("Cost (S04)", () => {
  // RULE (contract CostCategoryRow, build brief §5): variance is red only
  // when it is negative.
  it("colours a negative variance red and leaves a positive one the ink colour", () => {
    const data = buildProjectCost({
      categories: [
        { category: "works", approved: 100, committed: 100, spent: 100, forecast: 90, variance: -10 },
        { category: "equipment", approved: 100, committed: 100, spent: 100, forecast: 125, variance: 25 },
      ],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    const redSpan = Array.from(document.querySelectorAll("span.text-k-red")).find((s) =>
      s.textContent?.includes(formatEUR(-10)),
    );
    expect(redSpan).toBeTruthy();
    const positiveCell = Array.from(document.querySelectorAll("td.num")).find((c) =>
      c.textContent?.includes(formatEUR(25)),
    );
    expect(positiveCell?.querySelector("span.text-k-red")).toBeNull();
  });

  // RULE (contract ProjectCost / formatEURorDash): a null ledger renders "—", never "0 €".
  it("renders «—» for a null category ledger, never 0 €", () => {
    const data = buildProjectCost({
      categories: [{ category: "works", approved: 100_000, committed: null, spent: null, forecast: null, variance: null }],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    const row = document.querySelector("tbody tr");
    expect(row?.textContent).toContain("—");
    expect(row?.textContent).not.toContain("0 €");
  });

  // RULE (ADR-0021 §7, screenshot review 19/09/2026): every category value
  // is rendered through i18n, «uncategorised» included — never the raw key.
  it("renders the localised label for every known category, including uncategorised", () => {
    const data = buildProjectCost({
      categories: [
        { category: "works", approved: 1, committed: 1, spent: 1, forecast: 1, variance: 0 },
        { category: "uncategorised", approved: 1, committed: 1, spent: 1, forecast: 1, variance: 0 },
      ],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    expect(document.body.textContent).toContain("Χωρίς κατηγορία");
    expect(document.body.textContent).not.toContain("uncategorised");
  });

  it("falls back to the raw value for a category key with no translation", () => {
    const data = buildProjectCost({
      categories: [{ category: "not_a_real_category", approved: 1, committed: 1, spent: 1, forecast: 1, variance: 0 }],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    expect(document.body.textContent).toContain("not_a_real_category");
  });

  // RULE (build brief §5 S04): Απόκλιση is forecast − approved, computed on
  // the totals even when some categories only have one of the two figures.
  it("computes the totals «Απόκλιση» as forecast − approved when both totals exist", () => {
    const data = buildProjectCost({
      categories: [
        { category: "works", approved: 100, committed: 100, spent: 100, forecast: null, variance: null },
        { category: "fees", approved: null, committed: null, spent: null, forecast: 250, variance: null },
      ],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    const footer = document.querySelector(".border-t-2.border-k-ink");
    // totals approved = 100, totals forecast = 250, so totals variance = 150.
    expect(footer?.textContent).toContain(formatEUR(150));
    expect(footer?.textContent).not.toContain("—");
  });

  // RULE (build brief §5 S04): visible to project_engineer/estates_head/admin, read-only otherwise.
  it("shows the forecast-inputs form as editable for a project engineer", () => {
    renderWithIntl(<Cost {...baseProps} data={buildProjectCost()} state="default" roles={["project_engineer"]} />);
    expect(document.getElementById("fi-contingency")).toBeTruthy();
  });

  it("shows the forecast inputs read-only for a role that cannot write contracts", () => {
    renderWithIntl(<Cost {...baseProps} data={buildProjectCost()} state="default" roles={["executive_readonly"]} />);
    expect(document.getElementById("fi-contingency")).toBeNull();
    expect(document.body.textContent).toContain(formatEUR(80_000));
  });

  // RULE (build brief §5 S04, finance-only budget rule): the budget-lines
  // editor only mounts for finance/admin.
  it("mounts the budget-lines editor only for finance/admin", () => {
    renderWithIntl(<Cost {...baseProps} data={buildProjectCost()} state="default" roles={["finance"]} budgetLines={[]} />);
    expect(document.body.textContent).toContain("Γραμμές προϋπολογισμού");
  });

  it("hides the budget-lines editor for a project engineer", () => {
    renderWithIntl(<Cost {...baseProps} data={buildProjectCost()} state="default" roles={["project_engineer"]} budgetLines={[]} />);
    expect(document.body.textContent).not.toContain("Γραμμές προϋπολογισμού");
  });

  // R31: warnings never disable saving — the forecast form stays enabled next to a live warning.
  it("keeps the forecast-inputs form enabled next to a live warning", () => {
    const data = buildProjectCost({
      warnings: [
        {
          id: "w-1",
          key: "forecastOverApproved",
          projectId: "p-1",
          contractId: null,
          sentenceEl: "Η πρόβλεψη υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά 84.000 €",
          sentenceEn: "x",
          amount: 84_000,
          firedAt: "2026-09-01T10:00:00.000Z",
          dismissedById: null,
          dismissedByName: null,
          dismissedAt: null,
        },
      ],
    });
    renderWithIntl(<Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} />);
    expect(document.body.textContent).toContain("84.000 €");
    const contingencyInput = document.getElementById("fi-contingency") as HTMLInputElement;
    expect(contingencyInput.disabled).toBe(false);
  });

  it("fires onDismissWarning with the right id from the S04 page", () => {
    const onDismissWarning = vi.fn();
    const data = buildProjectCost({
      warnings: [
        {
          id: "w-9",
          key: "variationsOverTenPct",
          projectId: "p-1",
          contractId: null,
          sentenceEl: "x",
          sentenceEn: "x",
          amount: null,
          firedAt: "2026-09-01T10:00:00.000Z",
          dismissedById: null,
          dismissedByName: null,
          dismissedAt: null,
        },
      ],
    });
    renderWithIntl(
      <Cost {...baseProps} data={data} state="default" roles={["project_engineer"]} onDismissWarning={onDismissWarning} />,
    );
    const dismissButton = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Απόρριψη");
    dismissButton?.click();
    expect(onDismissWarning).toHaveBeenCalledWith("w-9");
  });

  it("returns just the noPermission node for the noPermission state", () => {
    renderWithIntl(<Cost {...baseProps} state="noPermission" />);
    expect(document.body.textContent).toContain("δεν έχετε πρόσβαση");
  });
});
