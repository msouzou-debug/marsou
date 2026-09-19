"use client";

// S11 (list) — R19–R25
//
/**
 * PermitsScreen — the network-aware wrapper around `Permits`. Owns
 * `usePermits` and the filter state (kept in this screen's own state rather
 * than the URL — the same `FilterBar` still lets an operator save a view
 * locally; a full URL-synced query like S02's is a reasonable next step
 * flagged in the hand-back summary rather than built here, since this list
 * has three simple facets, not S02's larger filter/sort/paginate surface).
 */
import { useEffect, useState } from "react";
import type { OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { usePermits } from "@/data/queries";
import { Permits, type PermitsFilters, type PermitsScreenState } from "./Permits";
import type { ReactNode } from "react";

export interface PermitsScreenProps {
  orgUnits: OrgUnit[];
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

const NO_FILTERS: PermitsFilters = { status: [], system: "", unit: "" };

export function PermitsScreen({ orgUnits, noPermission }: PermitsScreenProps) {
  const [filters, setFilters] = useState<PermitsFilters>(NO_FILTERS);
  const online = useOnlineStatus();
  const { data, error, isLoading, refetch } = usePermits({
    orgUnitId: filters.unit || undefined,
    status: filters.status.length > 0 ? filters.status : undefined,
    system: filters.system || undefined,
    page: 1,
    pageSize: 100,
  });

  let state: PermitsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  } else if (data && data.items.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <Permits
      data={data}
      state={state}
      filters={filters}
      orgUnits={orgUnits}
      onFilters={setFilters}
      onRetry={() => void refetch()}
      noPermission={noPermission}
    />
  );
}
