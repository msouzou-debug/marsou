import type { PreviewEntry } from "@/preview/types";
import { TableDemo } from "./Table.demo";

const entry: PreviewEntry = {
  id: "table",
  title: "Table",
  states: {
    default: () => <TableDemo state="default" />,
    loading: () => <TableDemo state="loading" />,
    empty: () => <TableDemo state="empty" />,
    error: () => <TableDemo state="error" />,
    noPermission: () => <TableDemo state="noPermission" />,
    offline: () => <TableDemo state="offline" />,
  },
  notes:
    "Cost breakdown for a fake project, «Ανακαίνιση χειρουργείων Γ.Ν. Λάρνακας». " +
    "All six states. Keyboard: ↑/↓ move row focus, Enter opens the focused row, " +
    "double-click a Πρόβλεψη cell to edit it, Enter saves, Esc cancels. " +
    "Density and the column chooser persist per table id in localStorage, so the " +
    "six state panels below keep separate settings. Offline renders the rows " +
    "read-only and disables export with the reason in the button's title. " +
    "No permission replaces the table, export included, because there is nothing " +
    "to export and no rows to read.",
};

export default entry;
