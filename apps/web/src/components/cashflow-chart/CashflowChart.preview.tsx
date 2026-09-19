import type { CashflowRow } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { CashflowChart } from "./CashflowChart";

const rows: CashflowRow[] = [
  { period: "2026-01", planned: 100_000, actual: 90_000, cumulativePlanned: 100_000, cumulativeActual: 90_000 },
  { period: "2026-02", planned: 150_000, actual: 130_000, cumulativePlanned: 250_000, cumulativeActual: 220_000 },
  { period: "2026-03", planned: 120_000, actual: 160_000, cumulativePlanned: 370_000, cumulativeActual: 380_000 },
  { period: "2026-04", planned: 100_000, actual: null, cumulativePlanned: 470_000, cumulativeActual: null },
  { period: "2026-05", planned: 100_000, actual: 90_000, cumulativePlanned: 570_000, cumulativeActual: 470_000 },
];

const entry: PreviewEntry = {
  id: "cashflow-chart",
  title: "CashflowChart",
  states: {
    default: () => <CashflowChart rows={rows} />,
    loading: () => <CashflowChart rows={[]} state="loading" />,
    empty: () => <CashflowChart rows={[]} state="empty" />,
    error: () => <CashflowChart rows={[]} state="error" />,
  },
  notes:
    "Plan is --k-grey, actual is --k-blue-deep, cumulative across the selected months. April's actual is null " +
    "(not yet posted) and breaks the actual line rather than dropping to zero. No pie charts, no chart library.",
};

export default entry;
