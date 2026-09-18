import type { PreviewEntry } from "@/preview/types";
import { OfflineChip } from "./OfflineChip";

const entry: PreviewEntry = {
  id: "offline-chip",
  title: "OfflineChip",
  states: {
    default: () => (
      <div className="grid gap-s-3 items-start">
        <div>
          <p className="eyebrow text-k-text mb-s-2">online, nothing queued (hidden — renders nothing below)</p>
          <OfflineChip status="online" queued={0} />
        </div>
        <OfflineChip status="offline" queued={3} />
        <OfflineChip status="syncing" queued={3} />
        <OfflineChip status="failed" queued={1} onRetry={() => {}} />
      </div>
    ),
  },
  notes:
    "State: default only — OfflineChip mirrors a connectivity signal the app shell already " +
    "tracks. RULE: never hidden while anything is queued, so status=\"online\" with queued>0 " +
    "(not shown separately here, covered in tests) still renders the amber message.",
};

export default entry;
