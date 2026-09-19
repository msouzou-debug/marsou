// S04 — R13, R16, R17, R31

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { Cost } from "./Cost";
import { buildBudgetLines, buildCashflowRows, buildProjectCost } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const withWarning = buildProjectCost({
  warnings: [
    {
      id: "w-1",
      key: "forecastOverApproved",
      projectId: "p-1",
      contractId: null,
      sentenceEl: "Η πρόβλεψη υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά 84.000 €",
      sentenceEn: "The forecast exceeds the approved budget by 84,000 €",
      amount: 84_000,
      firedAt: "2026-09-01T10:00:00.000Z",
      dismissedById: null,
      dismissedByName: null,
      dismissedAt: null,
    },
  ],
});

const commonProps = {
  projectId: "p-1",
  projectTitle: "Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας",
  projectCode: "PRJ-031",
  noPermission,
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

const entry: PreviewEntry = {
  id: "s04-cost",
  title: "S04 Κόστος",
  states: {
    default: () => <Cost {...commonProps} data={withWarning} state="default" roles={["project_engineer"]} />,
    loading: () => <Cost {...commonProps} state="loading" cashflowState="loading" />,
    empty: () => <Cost {...commonProps} data={buildProjectCost({ categories: [] })} state="default" roles={["finance"]} />,
    error: () => <Cost {...commonProps} state="error" cashflowState="error" onRetry={noop} />,
    noPermission: () => <Cost {...commonProps} state="noPermission" />,
    offline: () => <Cost {...commonProps} data={buildProjectCost()} state="offline" roles={["project_engineer"]} />,
  },
  notes:
    "default shows a live forecastOverApproved warning above the table, an editable forecast-inputs form " +
    "(project_engineer), the cash-flow chart/table and, for a finance role, the budget-lines editor. empty " +
    "reuses 'default' state with zero categories through the table's own empty branch. offline keeps the " +
    "cached figures and shows the read-only banner.",
};

export default entry;
