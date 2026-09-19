"use client";

// Fixture data for the preview gallery (ADR-0004), the same generator and
// the same fixed "today" S03's own `ProjectOverview.demo.tsx` uses, so the
// two previews show the same project's milestones.
import type { ReactNode } from "react";
import { buildProjectDetail } from "@/mocks/project-detail";
import { projects } from "@/mocks/projects";
import { Schedule, type ScheduleScreenState } from "./Schedule";

const fixtureProject = projects.find((p) => p.id === "PRJ-004") ?? projects[0];
const detail = buildProjectDetail(fixtureProject);
const today = new Date("2026-09-18T00:00:00.000Z");

export interface ScheduleDemoProps {
  state: ScheduleScreenState;
  noPermission: ReactNode;
}

export function ScheduleDemo({ state, noPermission }: ScheduleDemoProps) {
  const data = state === "error" || state === "loading" || state === "noPermission" ? undefined : detail;
  const emptyData = state === "empty" ? { ...detail, milestones: [] } : data;
  return (
    <Schedule
      data={emptyData}
      state={state === "empty" ? "default" : state}
      onRetry={() => undefined}
      noPermission={noPermission}
      today={today}
      roles={["estates_head"]}
    />
  );
}
