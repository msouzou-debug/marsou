import type { ReactNode } from "react";

// The five states every screen and data-holding component must show
// (UI instructions §6), plus "default" for the populated case. "submitting"
// is additional, for a write form/dialog mid-request (S02a's `ProjectForm`,
// S03's `PhaseDialog`) — distinct from "loading" (reading data in) the same
// way the UI instructions' own states table treats a button-local spinner
// under 300ms differently from a full skeleton.
export const previewStates = ["default", "loading", "empty", "error", "noPermission", "offline", "submitting"] as const;
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
