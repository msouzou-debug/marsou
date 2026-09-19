// S10 — R14

import type { AppRole } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { UnmatchedQueue } from "./UnmatchedQueue";
import { buildImportBatch, buildUnmatchedQueue } from "./fixture";

const noPermission = <NoPermission />;
const noop = () => undefined;

const commonProps = {
  batch: buildImportBatch(),
  noPermission,
  roles: ["finance"] as AppRole[],
  focusedIndex: 0,
  selectedIds: new Set<string>(),
  onMoveFocus: noop,
  onAccept: noop,
  onSkip: noop,
  onToggleSelect: noop,
  onCommit: noop,
  pickerOpen: false,
  onBulkAssignOpen: noop,
  onBulkAssignClose: noop,
  onBulkAssign: noop,
  bulkAssignSearch: "",
  onBulkAssignSearchChange: noop,
  bulkAssignProjectResults: [],
  bulkAssignProjectId: null,
  onBulkAssignSelectProject: noop,
  bulkAssignContractOptions: [],
  bulkAssignContractId: null,
  onBulkAssignSelectContract: noop,
};

const entry: PreviewEntry = {
  id: "s10-unmatched-queue",
  title: "S10 Ουρά αντιστοίχισης",
  states: {
    default: () => <UnmatchedQueue {...commonProps} queue={buildUnmatchedQueue(3)} state="default" />,
    loading: () => <UnmatchedQueue {...commonProps} state="loading" />,
    empty: () => <UnmatchedQueue {...commonProps} queue={buildUnmatchedQueue(0)} state="empty" />,
    error: () => <UnmatchedQueue {...commonProps} state="error" onRetry={noop} />,
    noPermission: () => <UnmatchedQueue {...commonProps} state="noPermission" />,
    offline: () => <UnmatchedQueue {...commonProps} queue={buildUnmatchedQueue(3)} state="offline" />,
  },
  notes:
    "Keyboard (↓/↑ move, Enter accept, 1-9 pick, s skip, Space select, Shift+A bulk assign) is " +
    "screens/s10-sap-import/useUnmatchedQueueKeyboard.ts, unit-tested there for every key. Below tablet " +
    "(1024px) this renders the plain read-only list branch instead — resize the gallery window to see it.",
};

export default entry;
