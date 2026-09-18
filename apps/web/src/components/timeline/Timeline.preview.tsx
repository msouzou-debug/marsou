import type { PreviewEntry } from "@/preview/types";
import { Timeline, type TimelineEntry } from "./Timeline";

const entries: TimelineEntry[] = [
  { id: "1", actor: "Γ. Νικολάου", action: "υπέβαλε αίτημα διακοπής", timestamp: "2026-03-14T10:42:00Z" },
  {
    id: "2",
    actor: "Μ. Ιωάννου",
    action: "άλλαξε την ημερομηνία λήξης",
    timestamp: "2026-03-14T11:05:00Z",
    diff: "Λήξη: 16/03/2026 → 18/03/2026",
  },
  { id: "3", actor: "Α. Χριστοδούλου", action: "ενέκρινε το αίτημα", timestamp: "2026-03-14T12:30:00Z" },
];

const entry: PreviewEntry = {
  id: "timeline",
  title: "Timeline",
  states: {
    default: () => <Timeline entries={entries} />,
    loading: () => <Timeline entries={[]} loading />,
    empty: () => <Timeline entries={[]} />,
  },
  notes:
    "Error/offline/noPermission belong to the screen that loads the audit trail, " +
    "not to this read-only list.",
};

export default entry;
