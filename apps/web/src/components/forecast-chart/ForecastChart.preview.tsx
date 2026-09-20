import type { PreviewEntry } from "@/preview/types";
import { ForecastChart } from "./ForecastChart";

const ROWS = [
  { year: 2026, value: 120_000 },
  { year: 2027, value: 340_000 },
  { year: 2028, value: 90_000 },
  { year: 2029, value: 410_000 },
  { year: 2030, value: 210_000 },
];

const entry: PreviewEntry = {
  id: "forecast-chart",
  title: "ForecastChart",
  states: {
    default: () => <ForecastChart rows={ROWS} />,
    loading: () => <ForecastChart rows={[]} state="loading" />,
    empty: () => <ForecastChart rows={[]} />,
    error: () => <ForecastChart rows={[]} state="error" />,
  },
  notes:
    "No noPermission/offline: S17c's screen gates access and this chart holds " +
    "no controls, the same reasoning CostBar/CashflowChart give. Every bar is " +
    "--k-blue-deep — no second series colour, and never a pie.",
};

export default entry;
