"use client";

// S02 — R03, R06

/**
 * ProjectsScreen — the network-aware wrapper around `Projects` (UI
 * instructions §5, §6). Same split as S01's `PortfolioScreen`/`Portfolio`
 * pair (see that pair's header comments): this is the only place that calls
 * `useProjects()`; `Projects` itself takes data and state as props so the
 * preview gallery can drive it with fixtures instead of the network.
 *
 * Resolves the five states from the query, the URL and `navigator.onLine`:
 * - `loading` while the query is in flight.
 * - `offline`, in preference to a load failure, once we already have data
 *   and the browser reports it is offline — the cached page stays usable.
 * - `noPermission` when the API rejects the request with 403.
 * - `error` for any other failure, with `refetch` wired to the retry button.
 * - `empty` when the response loaded with zero matching projects.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|----------------------------------------------------|
 * | orgUnits     | OrgUnit[]  | The caller's own visible units (R01), from the server. |
 * | eyebrow      | string     | Resolved server-side; passed straight through to `Projects`. |
 * | roles        | AppRole[]  | `me.roles`, from the server session — gates the «Προσθήκη» button. |
 * | noPermission | ReactNode  | The shell's `NoPermission`, resolved by the caller (a Server Component). |
 */

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import type { AppRole, OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useProjects } from "@/data/queries";
import { parseProjectsQuery } from "./query";
import { Projects, type ProjectsScreenState } from "./Projects";

export interface ProjectsScreenProps {
  orgUnits: OrgUnit[];
  eyebrow: string;
  roles: AppRole[];
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  // Lazy initial state reads the real value on mount; SSR (no `navigator`)
  // falls back to "online" so the server-rendered markup matches the
  // client's first render before hydration settles.
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

export function ProjectsScreen({ orgUnits, eyebrow, roles, noPermission }: ProjectsScreenProps) {
  const searchParams = useSearchParams();
  const query = parseProjectsQuery(searchParams);
  const { data, error, isLoading, refetch } = useProjects(query);
  const online = useOnlineStatus();

  let state: ProjectsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  } else if (data && data.items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <Projects
      data={data}
      state={state}
      query={query}
      orgUnits={orgUnits}
      eyebrow={eyebrow}
      roles={roles}
      onRetry={() => void refetch()}
      noPermission={noPermission}
    />
  );
}
