// S04 — fixture shared by the test and preview files.
import type { BudgetLine, CashflowRow, ProjectCost } from "@ecapital/shared";

export function buildProjectCost(overrides: Partial<ProjectCost> = {}): ProjectCost {
  return {
    projectId: "p-1",
    ledgers: { approved: 2_400_000, committed: 2_150_000, spent: 1_274_000, forecast: 2_320_000, costToComplete: 1_046_000 },
    committedSource: "CONTRACTS",
    forecastInputs: { contingency: 80_000, pendingVariationWeight: 0.5, contingencyNoteEl: "Απρόβλεπτα για γεωτεχνικές εκπλήξεις." },
    categories: [
      { category: "works", approved: 2_000_000, committed: 1_900_000, spent: 1_150_000, forecast: 1_980_000, variance: -20_000 },
      { category: "equipment", approved: 300_000, committed: 200_000, spent: 100_000, forecast: 260_000, variance: -40_000 },
      { category: "fees", approved: 100_000, committed: 50_000, spent: 24_000, forecast: 80_000, variance: -20_000 },
    ],
    warnings: [],
    lastSapImportAt: "2026-09-01T06:00:00.000Z",
    ...overrides,
  };
}

export function buildCashflowRows(): CashflowRow[] {
  return [
    { period: "2026-01", planned: 200_000, actual: 180_000, cumulativePlanned: 200_000, cumulativeActual: 180_000 },
    { period: "2026-02", planned: 200_000, actual: 210_000, cumulativePlanned: 400_000, cumulativeActual: 390_000 },
    { period: "2026-03", planned: 200_000, actual: null, cumulativePlanned: 600_000, cumulativeActual: null },
  ];
}

export function buildBudgetLines(): BudgetLine[] {
  return [
    { id: "bl-1", orgUnitId: "unit-1", projectId: "p-1", vintageId: "2026-02", lineType: "BUDGET", budgetYear: 2026, category: "works", sapGl: "600100", amount: 2_000_000 },
    { id: "bl-2", orgUnitId: "unit-1", projectId: "p-1", vintageId: "2026-02", lineType: "BUDGET", budgetYear: 2026, category: "equipment", sapGl: "600200", amount: 300_000 },
  ];
}
