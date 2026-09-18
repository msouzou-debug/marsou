"use client";

// S01 — R03

/**
 * PortfolioScreen — the network-aware wrapper around `Portfolio` (UI
 * instructions §5, §6). This is the *only* place on S01 that calls
 * `usePortfolio()`; `Portfolio` itself is pure so the preview gallery can
 * drive it with fixtures instead of the network.
 *
 * Resolves the five states from the query and `navigator.onLine`:
 * - `loading` while the query is in flight.
 * - `offline`, in preference to a load failure, once we already have data
 *   and the browser reports it is offline — the cached page stays usable.
 * - `noPermission` when the API rejects the request with 403.
 * - `error` for any other failure, with `refetch` wired to the retry button.
 * - `empty` when the response loaded but no unit has a single project.
 *
 * | Prop         | Type       | Notes                                             |
 * |--------------|------------|------------------------------------------------------|
 * | noPermission | ReactNode  | The shell's `NoPermission`, resolved by the caller (a Server Component — see `Portfolio`'s header comment). |
 */

import { useEffect, useState, type ReactNode } from "react";
import { usePortfolio } from "@/data/queries";
import { ApiError } from "@/data/client";
import { Portfolio, type PortfolioScreenState } from "./Portfolio";

export interface PortfolioScreenProps {
  noPermission: ReactNode;
}

function useOnlineStatus(): boolean {
  // Lazy initial state reads the real value on mount; SSR (no `navigator`)
  // falls back to "online" so the server-rendered markup matches the client's
  // first render before hydration settles.
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

export function PortfolioScreen({ noPermission }: PortfolioScreenProps) {
  const { data, error, isLoading, refetch } = usePortfolio();
  const online = useOnlineStatus();

  let state: PortfolioScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  } else if (data && data.units.every((unit) => unit.projectCount === 0)) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <Portfolio data={data} state={state} onRetry={() => void refetch()} noPermission={noPermission} />
  );
}
