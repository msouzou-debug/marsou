"use client";

// S18 «Εντολές εργασίας» — R33, R34
//
/**
 * WorkOrdersScreen — the network-aware wrapper around `WorkOrders`. Owns
 * `useMaintenanceSummary`, `useWorkOrders` and the filter state, the same
 * split `s16a-assets/AssetsScreen.tsx` uses.
 */
import { useState, type ReactNode } from "react";
import type { AppRole, OrgUnit } from "@ecapital/shared";
import { canRaiseWorkOrder, canViewScorecard } from "@/auth/roles";
import { ApiError } from "@/data/client";
import { useMaintenanceSummary, useWorkOrders } from "@/data/queries";
import { NO_WORK_ORDER_FILTERS, WorkOrders, type WorkOrdersFilters, type WorkOrdersScreenState } from "./WorkOrders";
import { useOnlineStatus } from "./useOnlineStatus";

export interface WorkOrdersScreenProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  noPermission: ReactNode;
  /** The unit the switcher remembers (cookie), or a `?unit=` link. */
  initialFilters?: Partial<WorkOrdersFilters>;
}

const PAGE_SIZE = 50;

export function WorkOrdersScreen({ orgUnits, roles, noPermission, initialFilters }: WorkOrdersScreenProps) {
  const [filters, setFilters] = useState<WorkOrdersFilters>({ ...NO_WORK_ORDER_FILTERS, ...initialFilters });
  // RULE (owner, 09/10/2026): the list pages, 50 rows at a time, newest call
  // first; a filter change goes back to page 1 so a stale page number never
  // shows an empty page of a shorter result.
  const [page, setPage] = useState(1);
  function changeFilters(next: WorkOrdersFilters) {
    setFilters(next);
    setPage(1);
  }
  const online = useOnlineStatus();
  const summary = useMaintenanceSummary(filters.unit || undefined);
  const { data, error, isLoading, refetch } = useWorkOrders({
    orgUnitId: filters.unit || undefined,
    kind: filters.kind || undefined,
    status: filters.status.length ? filters.status : undefined,
    band: filters.band || undefined,
    slaState: filters.slaState || undefined,
    q: filters.q || undefined,
    // RULE (task S18): newest call first.
    sort: "calledAt",
    dir: "desc",
    page,
    pageSize: PAGE_SIZE,
  });

  let state: WorkOrdersScreenState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else if (data && data.items.length === 0) state = "empty";
  else state = "default";

  const summaryState = summary.isLoading ? "loading" : summary.error ? "error" : "default";

  return (
    <WorkOrders
      summary={summary.data}
      summaryState={summaryState}
      data={data}
      state={state}
      filters={filters}
      orgUnits={orgUnits}
      onFilters={changeFilters}
      page={page}
      pageSize={PAGE_SIZE}
      onPage={setPage}
      onRetry={() => {
        void refetch();
        void summary.refetch();
      }}
      canRaise={canRaiseWorkOrder(roles)}
      canViewScorecard={canViewScorecard(roles)}
      noPermission={noPermission}
    />
  );
}
