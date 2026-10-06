"use client";

// S23 «Αναφορές» — R39
//
// ReportIndexScreen — `useReportCatalogue` and the state it resolves to.
import type { ReactNode } from "react";
import { ApiError } from "@/data/client";
import { useReportCatalogue } from "@/data/queries";
import { ReportIndex, type ReportIndexState } from "./ReportIndex";

export function ReportIndexScreen({ noPermission }: { noPermission: ReactNode }) {
  const { data, error, isLoading, refetch } = useReportCatalogue();

  let state: ReportIndexState;
  if (isLoading) state = "loading";
  else if (error) state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  else if ((data ?? []).length === 0) state = "empty";
  else state = "default";

  return <ReportIndex entries={data} state={state} onRetry={() => void refetch()} noPermission={noPermission} />;
}
