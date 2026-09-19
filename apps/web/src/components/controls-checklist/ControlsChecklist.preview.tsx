import type { PreviewEntry } from "@/preview/types";
import { ControlsChecklist } from "./ControlsChecklist";
import { ControlsChecklistDemo } from "./ControlsChecklist.preview.demo";

const entry: PreviewEntry = {
  id: "controls-checklist",
  title: "ControlsChecklist",
  states: {
    default: () => <ControlsChecklistDemo />,
    empty: () => <ControlsChecklist controls={[]} acknowledgedIds={[]} onToggle={() => undefined} />,
  },
  notes:
    "State: default and empty only — the list is reference data the wizard already has once " +
    "/icra/evaluate answered; loading/error/offline belong to that step. RULE: the text itself is " +
    "never editable, only acknowledged — Υποβολή stays disabled until every id is ticked " +
    "(allControlsAcknowledged, src/lib/permit-rules.ts).",
};

export default entry;
