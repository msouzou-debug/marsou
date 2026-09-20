"use client";

// S17c — R30 (M4 build brief item 6)
//
// ForecastScreen — the network-aware wrapper around `Forecast`. Owns
// `useReplacementForecast` and the year-range/unit filter state, the same
// split every other list-shaped screen in this app follows.
import { useEffect, useState, type ReactNode } from "react";
import type { OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useReplacementForecast } from "@/data/queries";
import { Forecast, type ForecastScreenState } from "./Forecast";

export interface ForecastScreenProps {
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

const THIS_YEAR = new Date().getFullYear();

export function ForecastScreen({ orgUnits, noPermission }: ForecastScreenProps) {
  const [from, setFrom] = useState(THIS_YEAR);
  const [to, setTo] = useState(THIS_YEAR + 10);
  const [unit, setUnit] = useState("");
  const online = useOnlineStatus();

  const { data, error, isLoading, refetch } = useReplacementForecast({ from, to, orgUnitId: unit || undefined });

  let state: ForecastScreenState;
  if (!online && data) {
    state = "offline";
  } else if (isLoading) {
    state = "loading";
  } else if (error) {
    state = error instanceof ApiError && (error.status === 403 || error.status === 404) ? "noPermission" : "error";
  } else if (data && data.length === 0) {
    state = "empty";
  } else {
    state = "default";
  }

  return (
    <Forecast
      rows={data}
      state={state}
      from={from}
      to={to}
      onRangeChange={(nextFrom, nextTo) => {
        setFrom(nextFrom);
        setTo(nextTo);
      }}
      unit={unit}
      orgUnits={orgUnits}
      onUnitChange={setUnit}
      onRetry={() => void refetch()}
      noPermission={noPermission}
    />
  );
}
