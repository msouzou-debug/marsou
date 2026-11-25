import type { PreviewEntry } from "@/preview/types";
import { SessionExpiredDialog } from "./SessionExpiredDialog";

const entry: PreviewEntry = {
  id: "session-expired",
  title: "SessionExpiredDialog",
  states: {
    default: () => <SessionExpiredDialog initiallyOpen />,
  },
  notes:
    "Only \"default\" applies — it opens on the session-expired event that `data/client.ts` " +
    "raises on any 401. Escape or «Παραμονή στη σελίδα» closes it.",
};

export default entry;
