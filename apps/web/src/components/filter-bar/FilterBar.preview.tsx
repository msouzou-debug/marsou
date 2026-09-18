import type { PreviewEntry } from "@/preview/types";
import { FilterBar, type FilterItem, type SavedView } from "./FilterBar";

const filters: FilterItem[] = [
  { key: "unit", label: "Μονάδα", value: "Νοσοκομείο Λευκωσίας" },
  { key: "status", label: "Κατάσταση", value: "Σε εξέλιξη" },
];

const savedViews: SavedView[] = [
  { id: "v1", label: "Έργα σε καθυστέρηση", filters: [{ key: "status", label: "Κατάσταση", value: "delayed" }] },
  { id: "v2", label: "Τα δικά μου έργα", filters: [{ key: "owner", label: "Υπεύθυνος", value: "me" }] },
];

const entry: PreviewEntry = {
  id: "filter-bar",
  title: "FilterBar",
  states: {
    default: () => <FilterBar filters={filters} onChange={() => {}} savedViews={savedViews} onSaveView={() => {}} />,
    empty: () => <FilterBar filters={[]} onChange={() => {}} savedViews={savedViews} onSaveView={() => {}} />,
  },
  notes:
    "Requires an app-router context to run (useSearchParams/useRouter) — the preview route provides " +
    "that; the unit tests mock next/navigation instead. Loading/error/offline/noPermission belong to " +
    "the list the bar filters, not to the bar itself.",
};

export default entry;
