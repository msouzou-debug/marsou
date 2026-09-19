"use client";

// S06 — R07
//
// RisksIssuesScreen — the network-aware wrapper around `RisksIssues`. Owns
// `useProjectDetail()` (the same query S03 and S05 use) and the four
// mutations this screen adds: `POST`/`PATCH` on `/projects/:id/risks` and
// `/projects/:id/issues`.
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole } from "@ecapital/shared";
import { Issue as IssueSchema, Risk as RiskSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useProjectDetail } from "@/data/queries";
import type { IssueFormValues, RiskFormValues } from "./schema";
import { RisksIssues, type RisksIssuesScreenState } from "./RisksIssues";

export interface RisksIssuesScreenProps {
  projectId: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export function RisksIssuesScreen({ projectId, roles, noPermission }: RisksIssuesScreenProps) {
  const { data, error, isLoading, refetch } = useProjectDetail(projectId);
  const online = useOnlineStatus();

  const [selectedRiskId, setSelectedRiskId] = useState<string | "new" | null>(null);
  const [selectedIssueId, setSelectedIssueId] = useState<string | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>(undefined);

  let state: RisksIssuesScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  // RULE: only one sheet is ever open — opening a risk closes any open
  // issue sheet and vice versa, so `sheetSaving`/`sheetApiError` can stay a
  // single pair rather than one per register.
  function selectRisk(id: string | "new" | null) {
    setApiError(undefined);
    setSelectedIssueId(null);
    setSelectedRiskId(id);
  }
  function selectIssue(id: string | "new" | null) {
    setApiError(undefined);
    setSelectedRiskId(null);
    setSelectedIssueId(id);
  }

  async function saveRisk(values: RiskFormValues): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      if (selectedRiskId === "new") {
        await apiMutate(`/projects/${encodeURIComponent(projectId)}/risks`, "POST", values, RiskSchema);
      } else if (selectedRiskId) {
        await apiMutate(`/projects/${encodeURIComponent(projectId)}/risks/${encodeURIComponent(selectedRiskId)}`, "PATCH", values, RiskSchema);
      }
      setSelectedRiskId(null);
      await refetch();
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function saveIssue(values: IssueFormValues): Promise<void> {
    setSaving(true);
    setApiError(undefined);
    try {
      if (selectedIssueId === "new") {
        await apiMutate(`/projects/${encodeURIComponent(projectId)}/issues`, "POST", values, IssueSchema);
      } else if (selectedIssueId) {
        await apiMutate(`/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(selectedIssueId)}`, "PATCH", values, IssueSchema);
      }
      setSelectedIssueId(null);
      await refetch();
    } catch (submitError) {
      setApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RisksIssues
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      selectedRiskId={selectedRiskId}
      selectedIssueId={selectedIssueId}
      onSelectRisk={selectRisk}
      onSelectIssue={selectIssue}
      sheetSaving={saving}
      sheetApiError={apiError}
      onSaveRisk={(values) => void saveRisk(values)}
      onSaveIssue={(values) => void saveIssue(values)}
    />
  );
}
