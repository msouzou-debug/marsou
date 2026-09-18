import type { PreviewEntry } from "@/preview/types";
import { IcraBadge } from "./IcraBadge";

const entry: PreviewEntry = {
  id: "icra-badge",
  title: "IcraBadge",
  states: {
    default: () => (
      <div className="grid gap-s-6">
        <div>
          <p className="eyebrow text-k-text mb-s-2">size=&quot;list&quot; (24px, S07 record header)</p>
          <div className="flex items-center gap-s-3">
            <IcraBadge icraClass="I" size="list" />
            <IcraBadge icraClass="II" size="list" />
            <IcraBadge icraClass="III" size="list" />
            <IcraBadge icraClass="IV" size="list" />
            <IcraBadge icraClass="V" size="list" />
          </div>
        </div>
        <div>
          <p className="eyebrow text-k-text mb-s-2">size=&quot;wizard&quot; (48px, S12 step 3)</p>
          <IcraBadge icraClass="IV" size="wizard" activityType="B" riskGroup="3" matrixVersion="v2.1" />
        </div>
        <div>
          <p className="eyebrow text-k-text mb-s-2">size=&quot;print&quot; (64px, S13 permit sheet)</p>
          <IcraBadge icraClass="IV" size="print" />
        </div>
        <div className="bg-k-purple p-s-4 rounded-k">
          <p className="eyebrow text-k-white mb-s-2">onPurple (PermitBanner)</p>
          <IcraBadge icraClass="IV" size="list" onPurple />
        </div>
      </div>
    ),
  },
  notes:
    "State: default only — the class is a computed value the parent already has. The matrix " +
    "excerpt only renders in the wizard size, and it is unconditional there (UI instructions §4 " +
    "RULE). An ICRA class outside I–V is out of scope: `icraClass` is typed to the fixed set and " +
    "no fallback rendering is implemented — see the hand-back summary.",
};

export default entry;
