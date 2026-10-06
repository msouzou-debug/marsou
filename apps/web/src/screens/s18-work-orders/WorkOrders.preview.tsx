// S18 — R33, R34

import { NoPermission } from "@/components/app-shell";
import { buildMaintenanceSummary, buildWorkOrderList } from "@/mocks/maintenance";
import type { PreviewEntry } from "@/preview/types";
import { NO_WORK_ORDER_FILTERS, WorkOrders, type WorkOrdersProps } from "./WorkOrders";

const base: WorkOrdersProps = {
  summary: buildMaintenanceSummary(),
  summaryState: "default",
  data: buildWorkOrderList(),
  state: "default",
  filters: NO_WORK_ORDER_FILTERS,
  orgUnits: [],
  onFilters: () => undefined,
  onRetry: () => undefined,
  canRaise: true,
  canViewScorecard: true,
  noPermission: <NoPermission />,
};

const entry: PreviewEntry = {
  id: "s18-work-orders",
  title: "S18 Εντολές εργασίας",
  states: {
    default: () => <WorkOrders {...base} />,
    loading: () => <WorkOrders {...base} data={undefined} state="loading" summary={undefined} summaryState="loading" />,
    empty: () => <WorkOrders {...base} data={{ items: [], total: 0 }} state="empty" />,
    error: () => <WorkOrders {...base} data={undefined} state="error" summaryState="error" />,
    noPermission: () => <WorkOrders {...base} state="noPermission" />,
    offline: () => <WorkOrders {...base} state="offline" />,
  },
  notes: "Fixtures from mocks/maintenance.ts: an acknowledged corrective order, an escalated one with the response overdue, and a PM order (one due-date chip). Phone width shows cards.",
};

export default entry;
