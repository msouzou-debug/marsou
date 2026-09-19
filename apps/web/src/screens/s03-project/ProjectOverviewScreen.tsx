"use client";

// S03 — R03, R04, R05, R07

/**
 * ProjectOverviewScreen — the network-aware wrapper around `ProjectOverview`
 * (UI instructions §5, §6). Same split as S01's `PortfolioScreen`/`Portfolio`
 * pair: this is the only place that calls `useProjectDetail()` — and, since
 * this build, the only place that calls `POST /projects/:id/phase`.
 *
 * Resolves the four states (there is no `empty` — see `ProjectOverview`'s
 * header comment) from the query and `navigator.onLine`:
 * - `loading` while the query is in flight.
 * - `offline`, in preference to a load failure, once we already have data
 *   and the browser reports it is offline.
 * - `noPermission` when the API answers 404 — RULE (ADR-0010): the real API
 *   gives the same 404 for "no such project" and "a project outside the
 *   caller's org units", so this never tries to tell the two apart.
 * - `error` for any other failure, with `refetch` wired to the retry button.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | projectId    | string     | The `[id]` route segment, from the server `page.tsx`. |
 * | roles        | AppRole[]  | `me.roles`, from the server session — the write controls' gate. |
 * | noPermission | ReactNode  | The shell's `NoPermission`, resolved by the caller (a Server Component). |
 */

import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, ProjectPhase } from "@ecapital/shared";
import { ProjectDetail as ProjectDetailSchema } from "@ecapital/shared";
import { ApiError, apiMutate } from "@/data/client";
import { useProjectContracts, useProjectDetail } from "@/data/queries";
import type { PhaseDialogApiError } from "./PhaseDialog";
import { ProjectOverview, type ProjectOverviewScreenState } from "./ProjectOverview";

export interface ProjectOverviewScreenProps {
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

export function ProjectOverviewScreen({ projectId, roles, noPermission }: ProjectOverviewScreenProps) {
  const { data, error, isLoading, refetch } = useProjectDetail(projectId);
  const contracts = useProjectContracts(projectId);
  const online = useOnlineStatus();

  const [phaseDialogOpen, setPhaseDialogOpen] = useState(false);
  const [phaseSubmitting, setPhaseSubmitting] = useState(false);
  const [phaseApiError, setPhaseApiError] = useState<PhaseDialogApiError | undefined>(undefined);

  let state: ProjectOverviewScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 404 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  function openPhaseDialog() {
    setPhaseApiError(undefined);
    setPhaseDialogOpen(true);
  }

  function closePhaseDialog() {
    if (phaseSubmitting) return;
    setPhaseDialogOpen(false);
  }

  async function submitPhaseChange(phase: ProjectPhase, reasonEl: string) {
    setPhaseSubmitting(true);
    setPhaseApiError(undefined);
    try {
      await apiMutate(`/projects/${encodeURIComponent(projectId)}/phase`, "POST", { phase, reasonEl }, ProjectDetailSchema);
      setPhaseDialogOpen(false);
      // RULE: "on success refresh the detail" — the new phase, the gate's
      // still-open siblings if any, and the timeline's new «άλλαξε τη φάση
      // του έργου» entry all come from the same `GET /projects/:id` this
      // re-runs, rather than patching the cached `ProjectDetail` by hand.
      await refetch();
    } catch (submitError) {
      if (submitError instanceof ApiError) {
        // RULE (R04): errors.gateOpen names the open gate in its sentence;
        // this screen already has that same milestone in `data.milestones`
        // (the current phase's own gate, if it has one and it is still
        // open), so the dialog can link straight to its card instead of
        // just repeating the API's sentence.
        const gate =
          submitError.key === "errors.gateOpen"
            ? [...(data?.milestones ?? [])]
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .find((m) => m.isGate && m.actualDate === null)
            : undefined;
        setPhaseApiError({ message: submitError.message, gateMilestoneId: gate?.id });
      } else {
        setPhaseApiError({ message: submitError instanceof Error ? submitError.message : String(submitError) });
      }
    } finally {
      setPhaseSubmitting(false);
    }
  }

  return (
    <ProjectOverview
      data={data}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      phaseDialogOpen={phaseDialogOpen}
      onOpenPhaseDialog={openPhaseDialog}
      onClosePhaseDialog={closePhaseDialog}
      onSubmitPhaseChange={(phase, reasonEl) => void submitPhaseChange(phase, reasonEl)}
      phaseSubmitting={phaseSubmitting}
      phaseApiError={phaseApiError}
      contracts={contracts.data?.items}
      contractsLoading={contracts.isLoading}
      contractsError={!!contracts.error}
    />
  );
}
