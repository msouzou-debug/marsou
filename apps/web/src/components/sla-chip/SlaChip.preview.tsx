import type { PreviewEntry } from "@/preview/types";
import { SlaChip } from "./SlaChip";

const NOW = Date.now();
const hours = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

const entry: PreviewEntry = {
  id: "sla-chip",
  title: "SlaChip",
  states: {
    default: () => (
      <div className="flex flex-wrap gap-s-3">
        <SlaChip dueAt={hours(30)} totalHours={48} />
        <SlaChip dueAt={hours(10)} totalHours={48} />
        <SlaChip dueAt={hours(2)} totalHours={48} />
        <SlaChip dueAt={hours(-3)} totalHours={48} />
      </div>
    ),
  },
  notes:
    "State: default only — an SlaChip reflects a due date its parent already has, so there is no " +
    "loading, empty, no-permission or offline state. Left to right: green (well within the SLA), " +
    "amber, red and breached, all against a 48-hour SLA.",
};

export default entry;
