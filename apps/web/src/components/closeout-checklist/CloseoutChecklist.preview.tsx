import type { PreviewEntry } from "@/preview/types";
import { CloseoutChecklistDemo } from "./CloseoutChecklist.preview.demo";

const entry: PreviewEntry = {
  id: "closeout-checklist",
  title: "CloseoutChecklist",
  states: {
    default: () => <CloseoutChecklistDemo isClinicalOwner />,
    noPermission: () => <CloseoutChecklistDemo isClinicalOwner={false} />,
  },
  notes:
    "\"noPermission\" here stands for a non-clinical-owner viewer: every box still shows, but the " +
    "clinical-acceptance checkbox is disabled with a title saying who still has to sign (RULE, " +
    "CAPEX-01 §6.6). Loading/error/empty/offline belong to the dialog that hosts this checklist.",
};

export default entry;
