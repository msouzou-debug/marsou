// S19 — R33, R34 (phone-first: view at 390px)

import { NoPermission } from "@/components/app-shell";
import { buildWorkOrderDetail } from "@/mocks/maintenance";
import type { PreviewEntry } from "@/preview/types";
import { WorkOrderRun, type WorkOrderRunProps } from "./WorkOrderRun";

const done = () => Promise.resolve();

const base: WorkOrderRunProps = {
  order: buildWorkOrderDetail({
    kind: "PM",
    status: "IN_PROGRESS",
    dueDate: "2026-10-15",
    sla: { response: null, restore: "GREEN", report: null },
    checklistEl: "Έλεγχος πιέσεων ψυκτικού\nΚαθαρισμός φίλτρων\nΈλεγχος συναγερμών",
  }),
  state: "default",
  unitName: "Γ.Ν. Λευκωσίας",
  canWork: true,
  onRetry: () => undefined,
  noPermission: <NoPermission />,
  onTransition: done,
  onUpload: done,
};

const entry: PreviewEntry = {
  id: "s19-work-order-run",
  title: "S19 Εκτέλεση εντολής",
  states: {
    default: () => <WorkOrderRun {...base} />,
    loading: () => <WorkOrderRun {...base} order={undefined} state="loading" />,
    error: () => <WorkOrderRun {...base} order={undefined} state="error" />,
    noPermission: () => <WorkOrderRun {...base} state="noPermission" />,
    offline: () => <WorkOrderRun {...base} state="offline" />,
  },
  notes: "No empty state: one order or none. Offline shows the chip and disables every write (no queue in M5, ADR-0031 §12). The action bar is fixed to the bottom of the viewport.",
};

export default entry;
