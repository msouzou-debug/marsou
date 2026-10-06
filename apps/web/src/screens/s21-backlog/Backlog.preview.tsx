// S21 — R35, R36

import { NoPermission } from "@/components/app-shell";
import { buildBacklogList, buildBacklogSummary } from "@/mocks/maintenance";
import type { PreviewEntry } from "@/preview/types";
import { Backlog, NO_BACKLOG_FILTERS, type BacklogProps } from "./Backlog";

const done = () => Promise.resolve();

const base: BacklogProps = {
  summary: buildBacklogSummary(),
  summaryState: "default",
  data: buildBacklogList(),
  state: "default",
  filters: NO_BACKLOG_FILTERS,
  orgUnits: [],
  onFilters: () => undefined,
  onRetry: () => undefined,
  canManage: true,
  canFund: true,
  onCreate: done,
  onPatch: done,
  onToProject: () => Promise.resolve({ projectId: "p-1", projectCode: "NGH-2026-044" }),
  onExport: () => undefined,
  noPermission: <NoPermission />,
};

const entry: PreviewEntry = {
  id: "s21-backlog",
  title: "S21 Εκκρεμότητες συντήρησης",
  states: {
    default: () => <Backlog {...base} />,
    loading: () => <Backlog {...base} data={undefined} state="loading" summaryState="loading" />,
    empty: () => <Backlog {...base} data={{ items: [], total: 0 }} state="empty" summary={[]} summaryState="empty" />,
    error: () => <Backlog {...base} data={undefined} state="error" summaryState="error" />,
    noPermission: () => <Backlog {...base} state="noPermission" />,
    offline: () => <Backlog {...base} state="offline" />,
  },
  notes: "One auto-drafted replacement (three corrective orders in twelve months) and one funded repair. Open an item's title for the drawer and «Σε έργο».",
};

export default entry;
