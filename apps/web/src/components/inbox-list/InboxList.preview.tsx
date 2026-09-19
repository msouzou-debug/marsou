import type { PreviewEntry } from "@/preview/types";
import { InboxList } from "./InboxList";
import { InboxListDemo } from "./InboxList.preview.demo";

const entry: PreviewEntry = {
  id: "inbox-list",
  title: "InboxList",
  states: {
    default: () => <InboxListDemo />,
    empty: () => <InboxList items={[]} focusedId={null} onFocus={() => undefined} onOpen={() => undefined} />,
  },
  notes:
    "State: default and empty only — loading/error/noPermission/offline belong to the S14 screen " +
    "around this list. Keyboard: ↑/↓, a, r, f, x — see useInboxKeyboard in screens/s14-approvals.",
};

export default entry;
