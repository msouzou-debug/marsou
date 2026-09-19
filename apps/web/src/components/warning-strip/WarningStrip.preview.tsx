import type { CostWarning } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { WarningStrip } from "./WarningStrip";

const live: CostWarning = {
  id: "w-1",
  key: "forecastOverApproved",
  projectId: "p-1",
  contractId: null,
  sentenceEl: "Η πρόβλεψη υπερβαίνει τον εγκεκριμένο προϋπολογισμό κατά € 84.000",
  sentenceEn: "The forecast exceeds the approved budget by € 84,000",
  amount: 84000,
  firedAt: "2026-09-01T10:00:00.000Z",
  dismissedById: null,
  dismissedByName: null,
  dismissedAt: null,
};

const second: CostWarning = {
  ...live,
  id: "w-2",
  key: "variationsOverTenPct",
  sentenceEl: "Οι εγκεκριμένες τροποποιήσεις ξεπερνούν το 10% της αρχικής αξίας",
  sentenceEn: "Approved variations exceed 10% of the original value",
  amount: null,
};

const dismissed: CostWarning = {
  ...live,
  id: "w-3",
  dismissedById: "u-1",
  dismissedByName: "Α. Παπαδοπούλου",
  dismissedAt: "2026-09-02T08:15:00.000Z",
};

const entry: PreviewEntry = {
  id: "warning-strip",
  title: "WarningStrip",
  states: {
    default: () => (
      <div className="grid gap-s-6">
        <WarningStrip warnings={[live, second]} onDismiss={() => undefined} />
        <WarningStrip warnings={[dismissed, second]} onDismiss={() => undefined} />
        <WarningStrip warnings={[live]} canDismiss={false} onDismiss={() => undefined} />
      </div>
    ),
  },
  notes:
    "Three strips: two live warnings with the amount already inside the API's own sentence; one already-dismissed " +
    "warning next to a still-live one, showing the 12px 'Απορρίφθηκε από …' replacement line; and a read-only " +
    "caller's view with no dismiss link at all. Loading/empty/error/offline/noPermission are skipped — the strip " +
    "renders already-resolved data handed down by S04's own screen wrapper, the same reasoning CostBar's header " +
    "comment gives, and an empty `warnings` array simply renders nothing.",
};

export default entry;
