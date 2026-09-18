import type { PreviewEntry } from "@/preview/types";
import { DecisionPanel, type DecisionFact } from "./DecisionPanel";

const facts: DecisionFact[] = [
  { label: "Σύστημα", value: "Κλιματισμός Πτέρυγας Β" },
  { label: "Διάρκεια", value: "3 ημ" },
  { label: "Ζητήθηκε από", value: "Γ. Νικολάου" },
];

const entry: PreviewEntry = {
  id: "decision-panel",
  title: "DecisionPanel",
  states: {
    default: () => (
      <div className="relative h-[520px] overflow-hidden rounded-k border border-k-grey">
        <DecisionPanel
          what="Αίτημα διακοπής"
          where="Νοσοκομείο Λευκωσίας › Πτέρυγα Β"
          facts={facts}
          onApprove={() => {}}
          onReturn={() => {}}
          onForward={() => {}}
          onClose={() => {}}
        />
      </div>
    ),
    loading: () => (
      <div className="relative h-[520px] overflow-hidden rounded-k border border-k-grey">
        <DecisionPanel
          what="Αίτημα διακοπής"
          where="Νοσοκομείο Λευκωσίας › Πτέρυγα Β"
          facts={[]}
          loading
          onApprove={() => {}}
          onReturn={() => {}}
          onClose={() => {}}
        />
      </div>
    ),
  },
  notes:
    "Keyboard: a approve, r reveal/submit the return comment, f forward, x close " +
    "(ignored while typing in the comment box). Empty/error/offline/noPermission belong " +
    "to the approvals list that opens this panel, not to the panel itself.",
};

export default entry;
