import type { PreviewEntry } from "@/preview/types";
import { TierChip } from "./TierChip";

const entry: PreviewEntry = {
  id: "tier-chip",
  title: "TierChip",
  states: {
    default: () => (
      <div className="flex gap-s-3">
        <TierChip tier="day-one" />
        <TierChip tier="optional" />
      </div>
    ),
  },
  notes:
    "State: default only — a TierChip reflects a value its parent already has (the screen's " +
    "help/map.json entry), so there is no loading, empty, no-permission or offline state to show. " +
    "Outline only, never filled (CONVENTIONS.md): brand blue for day-one, grey for optional.",
};

export default entry;
