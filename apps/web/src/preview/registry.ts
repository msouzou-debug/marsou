import type { PreviewEntry } from "./types";
import costBar from "@/components/cost-bar/CostBar.preview";
import table from "@/components/table/Table.preview";

// Every component adds its `<Name>.preview.tsx` default export here.
// Keep alphabetical. The gallery at /preview reads this list.
const entries: PreviewEntry[] = [costBar, table];

export function getPreviewEntries(): PreviewEntry[] {
  return entries;
}

export function getPreviewEntry(id: string): PreviewEntry | undefined {
  return entries.find((e) => e.id === id);
}
