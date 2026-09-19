// S10 — R14

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { Imports } from "./Imports";
import { buildImportBatch } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const batches = [
  buildImportBatch({ id: "b1", status: "COMMITTED", rowsUnmatched: 0 }),
  buildImportBatch({ id: "b2", status: "PENDING_ALLOCATION" }),
  buildImportBatch({ id: "b3", status: "DRY_RUN", report: "KSB1", fileName: "ksb1-2026-09.csv" }),
  buildImportBatch({ id: "b4", status: "FAILED", errorEl: "Άγνωστη μορφή αρχείου." }),
];

const entry: PreviewEntry = {
  id: "s10-imports",
  title: "S10 Εισαγωγή SAP",
  states: {
    default: () => <Imports data={batches} state="default" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />,
    loading: () => <Imports state="loading" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />,
    empty: () => <Imports data={[]} state="empty" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} />,
    error: () => <Imports state="error" noPermission={noPermission} roles={["finance"]} onRowOpen={noop} onUpload={noop} onRetry={noop} />,
    noPermission: () => <Imports state="noPermission" noPermission={noPermission} onRowOpen={noop} onUpload={noop} />,
  },
  notes:
    "The upload card only mounts for finance/admin (canImportSap). default shows four batches across every " +
    "status. offline is the table's own read-only banner, not previewed separately here.",
};

export default entry;
