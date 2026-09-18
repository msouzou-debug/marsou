import type { PreviewEntry } from "@/preview/types";
import { RagChip } from "./RagChip";

const entry: PreviewEntry = {
  id: "rag-chip",
  title: "RagChip",
  states: {
    default: () => (
      <div className="grid gap-s-4">
        <div className="flex gap-s-3">
          <RagChip value="green" />
          <RagChip value="amber" />
          <RagChip value="red" />
        </div>
        <div>
          <p className="eyebrow text-k-text mb-s-2">S01 · count variant</p>
          <div className="flex gap-s-3">
            <RagChip value="green" variant="count" count={7} />
            <RagChip value="amber" variant="count" count={3} />
            <RagChip value="red" variant="count" count={1} />
          </div>
        </div>
      </div>
    ),
  },
  notes:
    "State: default only — a RagChip reflects a value its parent already computed, so there is " +
    "no loading, empty, no-permission or offline state to show. The count variant (S01's unit " +
    "table) keeps the RAG label reachable via aria-label even though it shows only the number.",
};

export default entry;
