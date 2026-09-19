"use client";

// S15 — R25
//
// CalendarScreen — the network-aware wrapper around `Calendar`. Owns
// `useCalendar`, `useDisruptionHours` and the month/filter state.
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { OrgUnit } from "@ecapital/shared";
import { ApiError } from "@/data/client";
import { useCalendar, useDisruptionHours } from "@/data/queries";
import type { TableState } from "@/components/table";
import { Calendar, type CalendarFilters, type CalendarScreenState } from "./Calendar";

export interface CalendarScreenProps {
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

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const NO_FILTERS: CalendarFilters = { orgUnitId: "", areaType: "", system: "" };

export function CalendarScreen({ orgUnits, noPermission }: CalendarScreenProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [filters, setFilters] = useState<CalendarFilters>(NO_FILTERS);
  const online = useOnlineStatus();
  const router = useRouter();

  const from = `${year}-${pad2(month + 1)}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const to = `${year}-${pad2(month + 1)}-${pad2(lastDay)}`;

  const calendarQuery = useCalendar({
    from,
    to,
    orgUnitId: filters.orgUnitId || undefined,
    areaType: filters.areaType || undefined,
    system: filters.system || undefined,
  });
  const hoursQuery = useDisruptionHours(year);

  let state: CalendarScreenState;
  if (!online && calendarQuery.data) {
    state = "offline";
  } else if (calendarQuery.isLoading) {
    state = "loading";
  } else if (calendarQuery.error) {
    state = calendarQuery.error instanceof ApiError && calendarQuery.error.status === 403 ? "noPermission" : "error";
  } else {
    state = "default";
  }

  const hoursState: TableState = hoursQuery.isLoading ? "loading" : hoursQuery.error ? "error" : (hoursQuery.data?.length ?? 0) === 0 ? "empty" : "default";

  return (
    <Calendar
      entries={calendarQuery.data}
      hours={hoursQuery.data}
      state={state}
      hoursState={hoursState}
      year={year}
      month={month}
      onMonthChange={(y, m) => {
        setYear(y);
        setMonth(m);
      }}
      filters={filters}
      onFilters={setFilters}
      orgUnits={orgUnits}
      onOpenPermit={(id) => router.push(`/permits/${encodeURIComponent(id)}`)}
      onRetry={() => void calendarQuery.refetch()}
      noPermission={noPermission}
    />
  );
}
