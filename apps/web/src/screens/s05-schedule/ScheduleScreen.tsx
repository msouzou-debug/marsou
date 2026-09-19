"use client";

// S05 — R06
//
// ScheduleScreen — the network-aware wrapper around `Schedule`. Owns
// `useProjectDetail()` (the same query S03 uses — a milestone add or edit
// here refreshes the same cached `ProjectDetail`, so S03's own milestone
// card is never stale after a visit here) and the two mutations this screen
// adds: `POST /projects/:id/milestones` and `PATCH /projects/:id/milestones/:mid`.
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, Milestone } from "@ecapital/shared";
import { Milestone as MilestoneSchema, type MilestoneWrite } from "@ecapital/shared";
import { useTranslations } from "next-intl";
import { ApiError, apiMutate } from "@/data/client";
import { useProjectDetail } from "@/data/queries";
import { isIsoDate } from "./milestone-status";
import type { MilestoneFormValues } from "./schema";
import { Schedule, type ScheduleScreenState } from "./Schedule";

export interface ScheduleScreenProps {
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

/**
 * The full `MilestoneWrite` body a `PATCH` sends for one cell edit.
 *
 * RULE: `projects.service.ts`'s `updateMilestone` reads `titleEl`,
 * `isGate` and `baselineDate` unconditionally (it is not a partial merge
 * like the project's own `PATCH` — see `sentKeysOnly`'s header comment for
 * that contrast) and 422s with `errors.baselineFixed` the moment
 * `baselineDate` differs from what is stored. So every `PATCH` here echoes
 * the milestone's own current `titleEl`, `isGate` and `baselineDate`
 * unchanged and only ever varies the one field the caller edited.
 * Exported for its own unit test rather than only exercised through the
 * screen.
 */
export function buildMilestonePatch(
  milestone: Milestone,
  columnId: "forecast" | "actual",
  rawValue: string,
): MilestoneWrite {
  const value = rawValue.trim();
  const nextValue = value === "" ? null : value;
  return {
    titleEl: milestone.titleEl,
    baselineDate: milestone.baselineDate,
    isGate: milestone.isGate,
    sortOrder: milestone.sortOrder,
    forecastDate: columnId === "forecast" ? nextValue : milestone.forecastDate,
    actualDate: columnId === "actual" ? nextValue : milestone.actualDate,
  };
}

export function milestonePatchPath(projectId: string, milestoneId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`;
}

export function ScheduleScreen({ projectId, roles, noPermission }: ScheduleScreenProps) {
  const t = useTranslations();
  const { data, error, isLoading, refetch } = useProjectDetail(projectId);
  const online = useOnlineStatus();

  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addApiError, setAddApiError] = useState<string | undefined>(undefined);
  const [cellApiError, setCellApiError] = useState<string | undefined>(undefined);

  let state: ScheduleScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  function openAdd() {
    setAddApiError(undefined);
    setAddOpen(true);
  }

  function closeAdd() {
    if (addSaving) return;
    setAddOpen(false);
  }

  async function submitAdd(values: MilestoneFormValues): Promise<void> {
    setAddSaving(true);
    setAddApiError(undefined);
    try {
      const lastSortOrder = Math.max(-1, ...(data?.milestones.map((m) => m.sortOrder) ?? [-1]));
      const body: MilestoneWrite = {
        titleEl: values.titleEl,
        baselineDate: values.baselineDate,
        isGate: values.isGate,
        forecastDate: null,
        actualDate: null,
        sortOrder: lastSortOrder + 1,
      };
      await apiMutate(`/projects/${encodeURIComponent(projectId)}/milestones`, "POST", body, MilestoneSchema);
      setAddOpen(false);
      await refetch();
    } catch (submitError) {
      setAddApiError(submitError instanceof ApiError ? submitError.message : String(submitError));
    } finally {
      setAddSaving(false);
    }
  }

  async function handleCellEdit(milestone: Milestone, columnId: string, value: string): Promise<void> {
    if (columnId !== "forecast" && columnId !== "actual") return; // baseline is not `editable`; anything else is not either
    const trimmed = value.trim();
    if (trimmed !== "" && !isIsoDate(trimmed)) {
      setCellApiError(t("forms.invalidDate"));
      return;
    }
    setCellApiError(undefined);
    try {
      const body = buildMilestonePatch(milestone, columnId, trimmed);
      await apiMutate(milestonePatchPath(projectId, milestone.id), "PATCH", body, MilestoneSchema);
      await refetch();
    } catch (patchError) {
      setCellApiError(patchError instanceof ApiError ? patchError.message : String(patchError));
    }
  }

  return (
    <Schedule
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      addOpen={addOpen}
      onOpenAdd={openAdd}
      onCloseAdd={closeAdd}
      onSubmitAdd={(values) => void submitAdd(values)}
      addSaving={addSaving}
      addApiError={addApiError}
      onCellEdit={(milestone, columnId, value) => void handleCellEdit(milestone, columnId, value)}
      cellApiError={cellApiError}
    />
  );
}
