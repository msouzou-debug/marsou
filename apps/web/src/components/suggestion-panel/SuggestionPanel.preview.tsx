import type { Suggestion } from "@ecapital/shared";
import type { PreviewEntry } from "@/preview/types";
import { SuggestionPanel } from "./SuggestionPanel";

const suggestions: Suggestion[] = [
  {
    projectId: "p-1",
    projectCode: "PRJ-031",
    projectTitleEl: "Αντικατάσταση οχημάτων ασθενοφόρων",
    contractId: "c-1",
    contractRef: "CAP-2026-0012",
    confidence: "HIGH",
    reason: "SAME_WBS",
  },
  {
    projectId: "p-2",
    projectCode: "PRJ-040",
    projectTitleEl: "Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας",
    contractId: null,
    contractRef: null,
    confidence: "MEDIUM",
    reason: "REMEMBERED_VENDOR",
  },
  {
    projectId: "p-3",
    projectCode: "PRJ-055",
    projectTitleEl: "Στέγαστρο ελικοδρομίου",
    contractId: "c-3",
    contractRef: "CAP-2025-0044",
    confidence: "LOW",
    reason: "SIMILAR_TEXT",
  },
];

const entry: PreviewEntry = {
  id: "suggestion-panel",
  title: "SuggestionPanel",
  states: {
    default: () => <SuggestionPanel suggestions={suggestions} onPick={() => undefined} />,
    empty: () => <SuggestionPanel suggestions={[]} onPick={() => undefined} />,
  },
  notes:
    "default shows three suggestions, the top one prominent with its confidence phrased as text " +
    "(«Υψηλή αντιστοιχία — ίδιος κωδικός WBS»), and the full numbered 1–3 shortlist keyed against " +
    "S10's own 1–9 keyboard shortcut. empty is the 'no suggestion, use the bulk-assign picker' case. " +
    "Loading/error/offline/noPermission belong to the queue screen that supplies `suggestions`.",
};

export default entry;
