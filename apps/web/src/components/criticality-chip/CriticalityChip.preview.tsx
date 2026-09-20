import type { PreviewEntry } from "@/preview/types";
import { CriticalityChip } from "./CriticalityChip";

const entry: PreviewEntry = {
  id: "criticality-chip",
  title: "CriticalityChip",
  states: {
    default: () => (
      <div className="flex gap-s-3">
        {([1, 2, 3, 4, 5] as const).map((value) => (
          <CriticalityChip key={value} value={value} />
        ))}
      </div>
    ),
  },
  notes:
    "Only \"default\" applies — the band is a computed value the parent already has, " +
    "the same as RagChip/IcraBadge. 1–2 red, 3 amber, 4–5 grey; never purple.",
};

export default entry;
