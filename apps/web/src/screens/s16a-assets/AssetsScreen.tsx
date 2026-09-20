"use client";

// S16a — R26–R30, R45
//
/**
 * AssetsScreen — the network-aware wrapper around `Assets`. Owns `useAssets`
 * and the filter state, the same split `s11-permits/PermitsScreen.tsx` uses.
 */
import { useEffect, useState, type ReactNode } from "react";
import type { AppRole, OrgUnit } from "@ecapital/shared";
import { canViewReplacementForecast, canWriteAssets } from "@/auth/roles";
import { ApiError } from "@/data/client";
import { useAssets } from "@/data/queries";
import { Assets, type AssetsFilters, type AssetsScreenState } from "./Assets";

export interface AssetsScreenProps {
  orgUnits: OrgUnit[];
  roles: AppRole[];
  noPermission: ReactNode;
  /** S16's own «Προβολή παγίων» link (build brief item 7): preselects the unit/area filters on load. */
  initialFilters?: Partial<AssetsFilters>;
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

const NO_FILTERS: AssetsFilters = { unit: "", areaId: "", assetClass: "", criticality: 0, condition: "", status: "", q: "" };

export function AssetsScreen({ orgUnits, roles, noPermission, initialFilters }: AssetsScreenProps) {
  const [filters, setFilters] = useState<AssetsFilters>({ ...NO_FILTERS, ...initialFilters });
  const online = useOnlineStatus();
  const { data, error, isLoading, refetch } = useAssets({
    orgUnitId: filters.unit || undefined,
    areaId: filters.areaId || undefined,
    assetClass: filters.assetClass || undefined,
    criticality: filters.criticality || undefined,
    condition: filters.condition || undefined,
    status: filters.status || undefined,
    q: filters.q || undefined,
    sort: "tag",
    dir: "asc",
    page: 1,
    pageSize: 200,
  });

  let state: AssetsScreenState;
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
    <Assets
      data={data}
      state={state}
      filters={filters}
      orgUnits={orgUnits}
      onFilters={setFilters}
      onRetry={() => void refetch()}
      canWrite={canWriteAssets(roles)}
      canViewForecast={canViewReplacementForecast(roles)}
      noPermission={noPermission}
    />
  );
}
