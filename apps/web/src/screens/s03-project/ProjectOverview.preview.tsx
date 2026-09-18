// S03 — R03, R04, R05, R07

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { ProjectOverviewDemo } from "./ProjectOverview.demo";

const noPermission = <NoPermission />;

const entry: PreviewEntry = {
  id: "s03-project",
  title: "S03 Επισκόπηση έργου",
  states: {
    default: () => <ProjectOverviewDemo state="default" noPermission={noPermission} />,
    loading: () => <ProjectOverviewDemo state="loading" noPermission={noPermission} />,
    error: () => <ProjectOverviewDemo state="error" noPermission={noPermission} />,
    noPermission: () => <ProjectOverviewDemo state="noPermission" noPermission={noPermission} />,
    offline: () => <ProjectOverviewDemo state="offline" noPermission={noPermission} />,
  },
  notes:
    "Fixture: PRJ-004 run through the same `buildProjectDetail` generator the mock API " +
    "uses, at a fixed «today» (2026-09-18) so the overdue-milestone marking is stable. " +
    "\"empty\" is skipped: a detail page always names one project or shows noPermission/error " +
    "for it — there is no in-between filtered-to-nothing state for a single record (UI " +
    "instructions §6 applies per-screen, and this screen has no list to filter). Κόστος, " +
    "Χρονοδιάγραμμα and Κίνδυνοι και θέματα tabs are disabled with a tooltip — later screens.",
};

export default entry;
