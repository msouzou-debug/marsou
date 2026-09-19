"use client";

// See area-picker/AreaPicker.preview.demo.tsx's own header comment for why
// the interactive demo lives in its own "use client" module, separate from
// the preview entry's plain-data file.
import { useState } from "react";
import { InboxList } from "./InboxList";
import { ITEMS } from "./InboxList.preview.fixtures";

export function InboxListDemo() {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  return <InboxList items={ITEMS} focusedId={focusedId} onFocus={setFocusedId} onOpen={() => undefined} />;
}
