// S23a — R39. What every report body takes from the shared report page.
import type { TableState } from "@/components/table";

/** The page resolves noPermission itself; a body only ever sees these. */
export type BodyState = "default" | "loading" | "error" | "offline";

export interface BodyProps<R> {
  report?: R;
  state: BodyState;
  /** The same download as the page's «Λήψη Excel»: every table has its export button (CONVENTIONS.md). */
  onExport: () => void;
  onRetry?: () => void;
}

/** A body's Table state: `default` with nothing in it is the empty state. */
export function tableState(state: BodyState, rowCount: number): TableState {
  if (state === "default") return rowCount > 0 ? "default" : "empty";
  return state;
}

/** RULE (build brief): one sentence for every report with nothing in it. No action: there is nothing to add from a report. */
export const EMPTY = { messageKey: "screens.s23a.empty", actionLabelKey: "buttons.downloadExcel" } as const;
