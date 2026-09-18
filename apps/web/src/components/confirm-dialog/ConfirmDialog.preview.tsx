import type { PreviewEntry } from "@/preview/types";
import { ConfirmDialog } from "./ConfirmDialog";

const entry: PreviewEntry = {
  id: "confirm-dialog",
  title: "ConfirmDialog",
  states: {
    default: () => (
      <ConfirmDialog
        open
        title="Θέλετε να διαγράψετε το κόστος του έργου PRJ-014;"
        consequence="Η διαγραφή αφαιρεί οριστικά τις καταχωρήσεις κόστους και δεν αναιρείται."
        destructiveLabel="Διαγραφή"
        requireCode="PRJ-014"
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    ),
  },
  notes:
    "Only \"default\" applies — this dialog holds no data of its own. " +
    "Shown here with requireCode set (deletes cost data); omit that prop for a plain confirm.",
};

export default entry;
