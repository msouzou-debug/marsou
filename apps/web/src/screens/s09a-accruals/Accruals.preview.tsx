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
  // Over-invoiced (screenshot review 19/09/2026): the API already clamps
  // this to accrual: 0 and flags it — the row stays, «Σημείωση» says why.
  buildAccrualRow({
    contractId: "c-3",
    certNumber: 2,
    projectCode: "PRJ-LAR-04",
    projectTitleEl: "Ανακατασκευή ΤΑΕΠ Γ.Ν. Λάρνακας",
    certifiedNet: 1_200_000,
    invoiced: 1_770_550,
    accrual: 0,
    overInvoiced: true,
  }),
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
