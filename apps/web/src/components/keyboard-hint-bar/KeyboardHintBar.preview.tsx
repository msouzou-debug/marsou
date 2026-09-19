import type { PreviewEntry } from "@/preview/types";
import { KeyboardHintBar } from "./KeyboardHintBar";

const entry: PreviewEntry = {
  id: "keyboard-hint-bar",
  title: "KeyboardHintBar",
  states: {
    default: () => (
      <div className="grid gap-s-4">
        <KeyboardHintBar />
        <KeyboardHintBar selectedCount={3} />
      </div>
    ),
  },
  notes:
    "A static legend for S10's unmatched-queue keyboard (build brief §5): the actual key handling lives in " +
    "screens/s10-sap-import/useUnmatchedQueueKeyboard.ts, unit-tested there for every key. Only 'default' " +
    "applies — this component holds no data of its own.",
};

export default entry;
