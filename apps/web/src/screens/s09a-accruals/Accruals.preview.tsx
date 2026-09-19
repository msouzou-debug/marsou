// S09a — R18

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { Accruals } from "./Accruals";
import { buildAccrualRow } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const rows = [
  buildAccrualRow(),
  buildAccrualRow({ contractId: "c-2", certNumber: 5, projectCode: "PRJ-040", projectTitleEl: "Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας", certifiedNet: 900_000, invoiced: 850_000, accrual: 50_000 }),
];

const entry: PreviewEntry = {
  id: "s09a-accruals",
  title: "S09a Δεδουλευμένα",
  states: {
    default: () => <Accruals data={rows} year={2026} onYearChange={noop} state="default" noPermission={noPermission} onExport={noop} />,
    loading: () => <Accruals year={2026} onYearChange={noop} state="loading" noPermission={noPermission} onExport={noop} />,
    empty: () => <Accruals data={[]} year={2026} onYearChange={noop} state="empty" noPermission={noPermission} onExport={noop} />,
    error: () => <Accruals year={2026} onYearChange={noop} state="error" noPermission={noPermission} onExport={noop} onRetry={noop} />,
    noPermission: () => <Accruals year={2026} onYearChange={noop} state="noPermission" noPermission={noPermission} onExport={noop} />,
  },
  notes: "The API produces the xlsx with live formulas (build brief §5 S09a) — this screen only downloads it.",
};

export default entry;
