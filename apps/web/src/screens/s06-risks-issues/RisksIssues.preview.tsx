// S06 — R07

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { RisksIssuesDemo } from "./RisksIssues.demo";

const noPermission = <NoPermission />;

const entry: PreviewEntry = {
  id: "s06-risks-issues",
  title: "S06 Κίνδυνοι και θέματα",
  states: {
    default: () => <RisksIssuesDemo state="default" noPermission={noPermission} />,
    loading: () => <RisksIssuesDemo state="loading" noPermission={noPermission} />,
    empty: () => <RisksIssuesDemo state="empty" noPermission={noPermission} />,
    error: () => <RisksIssuesDemo state="error" noPermission={noPermission} />,
    noPermission: () => <RisksIssuesDemo state="noPermission" noPermission={noPermission} />,
    offline: () => <RisksIssuesDemo state="offline" noPermission={noPermission} />,
  },
  notes:
    "Fixture: PRJ-004 run through the same `buildProjectDetail` generator S03's and S05's own " +
    "previews use, at a fixed «today» (2026-09-18). Phone width shows cards instead of the two " +
    "tables (`RiskCards`/`IssueCards`) — resize the preview frame to see the switch.",
};

export default entry;
