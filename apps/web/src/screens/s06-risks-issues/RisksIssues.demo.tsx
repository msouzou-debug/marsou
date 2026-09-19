"use client";

// Fixture data for the preview gallery (ADR-0004) — the same generator and
// fixed "today" S03's and S05's own previews use.
import type { ReactNode } from "react";
import { buildProjectDetail } from "@/mocks/project-detail";
import { projects } from "@/mocks/projects";
import { RisksIssues, type RisksIssuesScreenState } from "./RisksIssues";

const fixtureProject = projects.find((p) => p.id === "PRJ-004") ?? projects[0];
const detail = buildProjectDetail(fixtureProject);
const today = new Date("2026-09-18T00:00:00.000Z");

export interface RisksIssuesDemoProps {
  state: RisksIssuesScreenState | "empty";
  noPermission: ReactNode;
}

export function RisksIssuesDemo({ state, noPermission }: RisksIssuesDemoProps) {
  const networkState = state === "empty" ? "default" : state;
  const data =
    networkState === "error" || networkState === "loading" || networkState === "noPermission"
      ? undefined
      : state === "empty"
        ? { ...detail, risks: [], issues: [] }
        : detail;
  return <RisksIssues data={data} state={networkState} onRetry={() => undefined} noPermission={noPermission} today={today} roles={["estates_head"]} />;
}
