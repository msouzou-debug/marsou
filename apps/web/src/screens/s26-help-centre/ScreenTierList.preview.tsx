// S26 «Οδηγός χρήσης» — screen list by training tier

import type { PreviewEntry } from "@/preview/types";
import type { TierScreen } from "@/help/list-screens-by-tier";
import { ScreenTierList } from "./ScreenTierList";

const dayOne: TierScreen[] = [
  { id: "S01", title: "Χαρτοφυλάκιο έργων", persona: ["estates_head", "executive_readonly", "finance"] },
  { id: "S02", title: "Έργα", persona: ["estates_head", "project_engineer", "finance"] },
];

const optional: TierScreen[] = [
  { id: "S06", title: "Κίνδυνοι και θέματα", persona: ["estates_head", "project_engineer"] },
  { id: "S15", title: "Ημερολόγιο", persona: ["admin", "estates_head"] },
];

const entry: PreviewEntry = {
  id: "s26-screen-tier-list",
  title: "S26 Οθόνες ανά φάση",
  states: {
    default: () => <ScreenTierList dayOne={dayOne} optional={optional} />,
    empty: () => <ScreenTierList dayOne={[]} optional={[]} />,
  },
  notes:
    "Only default and empty apply: this reads the static help/map.json (via listScreensByTier) — " +
    "there is no fetch, so no loading, no-permission or offline state, and every persona sees the " +
    "same list.",
};

export default entry;
