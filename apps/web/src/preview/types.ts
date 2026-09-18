import type { ReactNode } from "react";

// The five states every screen and data-holding component must show
// (UI instructions §6), plus "default" for the populated case.
export const previewStates = ["default", "loading", "empty", "error", "noPermission", "offline"] as const;
export type PreviewState = (typeof previewStates)[number];

export interface PreviewEntry {
  /** kebab-case, matches the component folder name, e.g. "rag-chip" */
  id: string;
  /** English display name for the gallery index */
  title: string;
  /** Which of the states apply. Components without data (EmptyState itself,
   *  ConfirmDialog) declare only "default"; say why in `notes`. */
  states: Partial<Record<PreviewState, () => ReactNode>>;
  /** Anything a reviewer needs to know: skipped states and why, keyboard keys */
  notes?: string;
}
