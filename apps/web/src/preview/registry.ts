import type { PreviewEntry } from "./types";

// Every component adds its `<Name>.preview.tsx` default export here.
// Keep alphabetical. The gallery at /preview reads this list.
const entries: PreviewEntry[] = [];

export function getPreviewEntries(): PreviewEntry[] {
  return entries;
}

export function getPreviewEntry(id: string): PreviewEntry | undefined {
  return entries.find((e) => e.id === id);
}
