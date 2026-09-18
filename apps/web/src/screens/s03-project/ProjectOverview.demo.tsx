"use client";

// Fixture data for the preview gallery (ADR-0004). Built from a mocks/projects.ts
// fixture through `buildProjectDetail`, the same generator the mock API route
// uses, so the preview shows exactly what the screen renders in the app.

import type { ReactNode } from "react";
import { buildProjectDetail } from "@/mocks/project-detail";
import { projects } from "@/mocks/projects";
import { ProjectOverview, type ProjectOverviewScreenState } from "./ProjectOverview";

// PRJ-004 (Troodos, PREPARATION) has a mix of past and future planned dates
// in the fixtures, giving the generator good odds of an overdue milestone;
// picked deterministically rather than "whichever one looks right".
const fixtureProject = projects.find((p) => p.id === "PRJ-004") ?? projects[0];
const detail = buildProjectDetail(fixtureProject);

// A fixed "today" so the preview's overdue marking does not depend on when
// it happens to be opened.
const today = new Date("2026-09-18T00:00:00.000Z");

export interface ProjectOverviewDemoProps {
  state: ProjectOverviewScreenState;
  noPermission: ReactNode;
}

export function ProjectOverviewDemo({ state, noPermission }: ProjectOverviewDemoProps) {
  const data = state === "error" || state === "loading" || state === "noPermission" ? undefined : detail;
  return <ProjectOverview data={data} state={state} onRetry={() => undefined} noPermission={noPermission} today={today} />;
}
