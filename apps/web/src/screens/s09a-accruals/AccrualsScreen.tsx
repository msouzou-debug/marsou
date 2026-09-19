"use client";

// S09a — R18

import { useEffect, useState, type ReactNode } from "react";
import type { AppRole } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useAccruals } from "@/data/queries";
import { Accruals, type AccrualsScreenState } from "./Accruals";

export interface AccrualsScreenProps {
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

export function AccrualsScreen({ roles, noPermission }: AccrualsScreenProps) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, error, isLoading, refetch } = useAccruals(year);
  const online = useOnlineStatus();
  const [exporting, setExporting] = useState(false);

  let state: AccrualsScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && error.status === 403 ? "noPermission" : "error";
  } else if ((data ?? []).length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  function exportAccruals(): void {
    setExporting(true);
    // Same real-navigation download the S04 export button uses — the proxy
    // forwards the upstream's Content-Disposition unchanged.
    window.location.href = `/api/proxy/cost/accruals/export?year=${year}`;
    window.setTimeout(() => setExporting(false), 1500);
  }

  return (
    <Accruals
      data={data}
      year={year}
      onYearChange={setYear}
      state={state}
      onRetry={() => void refetch()}
      noPermission={noPermission}
      roles={roles}
      onExport={exportAccruals}
      exporting={exporting}
    />
  );
}
