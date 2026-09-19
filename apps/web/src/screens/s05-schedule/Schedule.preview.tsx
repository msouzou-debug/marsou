// S05 — R06

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { ScheduleDemo } from "./Schedule.demo";

const noPermission = <NoPermission />;

const entry: PreviewEntry = {
  id: "s05-schedule",
  title: "S05 Χρονοδιάγραμμα",
  states: {
    default: () => <ScheduleDemo state="default" noPermission={noPermission} />,
    loading: () => <ScheduleDemo state="loading" noPermission={noPermission} />,
    empty: () => <ScheduleDemo state="empty" noPermission={noPermission} />,
    error: () => <ScheduleDemo state="error" noPermission={noPermission} />,
    noPermission: () => <ScheduleDemo state="noPermission" noPermission={noPermission} />,
    offline: () => <ScheduleDemo state="offline" noPermission={noPermission} />,
  },
  notes:
    "Fixture: PRJ-004 run through the same `buildProjectDetail` generator S03's own preview uses, " +
    "at a fixed «today» (2026-09-18). The «Προσθήκη» dialog and the inline forecast/actual editor " +
    "both need `estates_head` (this preview's role) to appear at all.",
};

export default entry;
