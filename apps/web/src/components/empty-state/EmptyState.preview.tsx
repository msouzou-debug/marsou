import type { PreviewEntry } from "@/preview/types";
import { EmptyState } from "./EmptyState";

const entry: PreviewEntry = {
  id: "empty-state",
  title: "EmptyState",
  states: {
    default: () => (
      <EmptyState
        message="Δεν υπάρχουν ανοιχτές εντολές εργασίας για αυτό το πάγιο."
        actionLabel="Νέα εντολή"
        onAction={() => {}}
      />
    ),
  },
  notes:
    "Only \"default\" applies — EmptyState holds no data of its own, so loading/error/offline are not meaningful for it.",
};

export default entry;
