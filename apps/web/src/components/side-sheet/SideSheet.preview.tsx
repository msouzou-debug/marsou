import type { PreviewEntry } from "@/preview/types";
import { SideSheet } from "./SideSheet";

const entry: PreviewEntry = {
  id: "side-sheet",
  title: "SideSheet",
  states: {
    default: () => (
      <SideSheet title="Αίτημα διευκρίνισης 2" onClose={() => {}}>
        <p className="text-fs-14 text-k-ink">Επιβεβαιώνετε τον τύπο των πυράντοχων θυρών στον θάλαμο Α1;</p>
      </SideSheet>
    ),
  },
  notes:
    "Only \"default\" applies — the sheet holds no data of its own. " +
    "Ways out: «Πίσω στη λίστα» at the top, Escape, or a click on the backdrop. " +
    "It sits at z-40, above the top bar (z-30) and a table's sticky header (z-10).",
};

export default entry;
