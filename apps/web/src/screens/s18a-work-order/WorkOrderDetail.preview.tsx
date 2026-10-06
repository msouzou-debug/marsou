// S18a — R33, R34, R35

import { NoPermission } from "@/components/app-shell";
import { buildWorkOrderDetail } from "@/mocks/maintenance";
import type { PreviewEntry } from "@/preview/types";
import { WorkOrderDetail, type WorkOrderDetailProps } from "./WorkOrderDetail";

const done = () => Promise.resolve();

const base: WorkOrderDetailProps = {
  order: buildWorkOrderDetail({ repeatCount: 3 }),
  state: "default",
  onRetry: () => undefined,
  noPermission: <NoPermission />,
  canWork: true,
  canManageBacklog: true,
  onTransition: done,
  onPatch: done,
  onNote: done,
  onUpload: done,
  onToBacklog: done,
};

const entry: PreviewEntry = {
  id: "s18a-work-order",
  title: "S18a Εντολή εργασίας",
  states: {
    default: () => <WorkOrderDetail {...base} />,
    loading: () => <WorkOrderDetail {...base} order={undefined} state="loading" />,
    error: () => <WorkOrderDetail {...base} order={undefined} state="error" />,
    noPermission: () => <WorkOrderDetail {...base} state="noPermission" />,
    offline: () => <WorkOrderDetail {...base} state="offline" />,
  },
  notes: "No empty state: a record page names one order or none. The default shows the third-failure warning (repeatCount 3). Writes resolve immediately in the gallery.",
};

export default entry;
