"use client";

// S03 — R03, R04, R05

/**
 * ProjectOverviewScreen — the network-aware wrapper around `ProjectOverview`
 * (UI instructions §5, §6). Same split as S01's `PortfolioScreen`/`Portfolio`
 * pair: this is the only place that calls `useProjectDetail()`.
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
 * | noPermission | ReactNode  | The shell's `NoPermission`, resolved by the caller (a Server Component). |
 */

import { useEffect, useState, type ReactNode } from "react";
import { ApiError } from "@/data/client";
import { useProjectDetail } from "@/data/queries";
import { ProjectOverview, type ProjectOverviewScreenState } from "./ProjectOverview";

export interface ProjectOverviewScreenProps {
  projectId: string;
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

export function ProjectOverviewScreen({ projectId, noPermission }: ProjectOverviewScreenProps) {
  const { data, error, isLoading, refetch } = useProjectDetail(projectId);
  const online = useOnlineStatus();

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

  return <ProjectOverview data={data} state={state} onRetry={() => void refetch()} noPermission={noPermission} />;
}
