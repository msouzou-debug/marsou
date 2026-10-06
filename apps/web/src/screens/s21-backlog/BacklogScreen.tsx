"use client";

// S21 «Εκκρεμότητες συντήρησης» — R35, R36
//
// BacklogScreen — owns the filters, `useBacklog`, `useBacklogSummary` and the
// three writes; the Excel is the S09a real-navigation download through the
// proxy, which forwards the API's Content-Disposition unchanged.
import { useState, type ReactNode } from "react";
import { z } from "zod";
import { BacklogItem, type AppRole, type BacklogCreate, type BacklogPatch, type OrgUnit } from "@ecapital/shared";
import { useQueryClient } from "@tanstack/react-query";
import { canFundBacklog, canManageBacklog } from "@/auth/roles";
import { ApiError, apiMutate } from "@/data/client";
import { useBacklog, useBacklogSummary } from "@/data/queries";
import { useOnlineStatus } from "@/screens/s18-work-orders/useOnlineStatus";
import { Backlog, NO_BACKLOG_FILTERS, type BacklogFilters, type BacklogScreenState } from "./Backlog";

export interface BacklogScreenProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  noPermission: ReactNode;
  initialFilters?: Partial<BacklogFilters>;
}

const ToProject = z.object({ projectId: z.string(), projectCode: z.string(), item: BacklogItem });

export function backlogExportHref(orgUnitId: string): string {
  return orgUnitId ? `/api/proxy/backlog/export.xlsx?orgUnitId=${encodeURIComponent(orgUnitId)}` : "/api/proxy/backlog/export.xlsx";
}

export function BacklogScreen({ orgUnits, roles, noPermission, initialFilters }: BacklogScreenProps) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [filters, setFilters] = useState<BacklogFilters>({ ...NO_BACKLOG_FILTERS, ...initialFilters });
  const [exporting, setExporting] = useState(false);

  const summary = useBacklogSummary(filters.unit || undefined);
  const { data, error, isLoading, refetch } = useBacklog({
    orgUnitId: filters.unit || undefined,
    riskBand: filters.band || undefined,
    status: filters.status.length ? filters.status : undefined,
    kind: filters.kind || undefined,
    autoDrafted: filters.autoOnly ? true : undefined,
    sort: "riskBand",
    dir: "asc",
    page: 1,
    pageSize: 100,
  });

  let state: BacklogScreenState;
  if (!online && data) state = "offline";
  else if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  else if (data && data.items.length === 0) state = "empty";
  else state = "default";

  const summaryState = summary.isLoading ? "loading" : summary.error ? "error" : (summary.data ?? []).length === 0 ? "empty" : "default";

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["backlog"] });
    await queryClient.invalidateQueries({ queryKey: ["backlog-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["maintenance-summary"] });
  }

  return (
    <Backlog
      summary={summary.data}
      summaryState={summaryState}
      data={data}
      state={state}
      filters={filters}
      orgUnits={orgUnits}
      onFilters={setFilters}
      onRetry={() => {
        void refetch();
        void summary.refetch();
      }}
      canManage={canManageBacklog(roles)}
      canFund={canFundBacklog(roles)}
      onCreate={async (body: BacklogCreate) => {
        await apiMutate("/backlog", "POST", body, z.unknown());
        await refresh();
      }}
      onPatch={async (id: string, patch: BacklogPatch) => {
        await apiMutate(`/backlog/${encodeURIComponent(id)}`, "PATCH", patch, z.unknown());
        await refresh();
      }}
      onToProject={async (id: string) => {
        const result = await apiMutate(`/backlog/${encodeURIComponent(id)}/to-project`, "POST", {}, ToProject);
        await refresh();
        return { projectId: result.projectId, projectCode: result.projectCode };
      }}
      onExport={() => {
        setExporting(true);
        window.location.href = backlogExportHref(filters.unit);
        window.setTimeout(() => setExporting(false), 1500);
      }}
      exporting={exporting}
      noPermission={noPermission}
    />
  );
}
