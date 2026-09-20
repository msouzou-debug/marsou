import type { PreviewEntry } from "@/preview/types";
import { ConditionChip } from "./ConditionChip";

const entry: PreviewEntry = {
  id: "condition-chip",
  title: "ConditionChip",
  states: {
    default: () => (
      <div className="flex gap-s-3">
        {(["A", "B", "C", "D", "E"] as const).map((value) => (
          <ConditionChip key={value} value={value} />
        ))}
        <ConditionChip value={null} />
      </div>
    ),
  },
  notes:
    "Only \"default\" applies. A/B green, C amber, D/E red; null renders the " +
    "«Δεν έχει αξιολογηθεί» sentence, never a chip with a guessed colour.",
};

export default entry;
