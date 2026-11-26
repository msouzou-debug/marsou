import type { PreviewEntry } from "@/preview/types";
import { CloseoutChecklistDemo } from "./CloseoutChecklist.preview.demo";

const entry: PreviewEntry = {
  id: "closeout-checklist",
  title: "CloseoutChecklist",
  states: {
    default: () => <CloseoutChecklistDemo />,
    noPermission: () => <CloseoutChecklistDemo readOnly />,
  },
  notes:
    "\"default\" is the works side ticking the five boxes before «Υποβολή για αποδοχή». " +
    "\"noPermission\" here stands for the clinical owner reading the submitted checklist: read-only, " +
    "the note as text. The acceptance is the owner's own button on the permit page, not a box " +
    "(OWNER 26/11/2026, CAPEX-01 §6.6). Loading/error/empty/offline belong to the dialog that hosts it.",
};

export default entry;
