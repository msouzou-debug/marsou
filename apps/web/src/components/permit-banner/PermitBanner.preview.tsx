import type { PreviewEntry } from "@/preview/types";
import { PermitBanner } from "./PermitBanner";

const entry: PreviewEntry = {
  id: "permit-banner",
  title: "PermitBanner",
  states: {
    default: () => (
      <div className="grid gap-s-4">
        <PermitBanner state="inForce" validFrom="2026-03-01T00:00:00Z" validTo="2026-06-01T00:00:00Z" icraClass="IV" />
        <PermitBanner
          state="pendingApproval"
          validFrom="2026-06-02T00:00:00Z"
          validTo="2026-09-01T00:00:00Z"
          icraClass="III"
          onDismiss={() => {}}
        />
        <PermitBanner
          state="expired"
          validFrom="2025-09-01T00:00:00Z"
          validTo="2026-01-01T00:00:00Z"
          icraClass="II"
          onDismiss={() => {}}
        />
        <PermitBanner
          state="revoked"
          validFrom="2026-01-10T00:00:00Z"
          validTo="2026-02-10T00:00:00Z"
          icraClass="V"
          onDismiss={() => {}}
        />
      </div>
    ),
  },
  notes:
    "State: default only, one banner per permit state (UI instructions §4). Notice the dismiss " +
    "control (×) is absent on the «Σε ισχύ» banner even though the other three were given " +
    "onDismiss — RULE: a live permit can never be dismissed off screen.",
};

export default entry;
