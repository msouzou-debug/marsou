"use client";

// See area-picker/AreaPicker.preview.demo.tsx's own header comment for why
// the interactive demo lives in its own "use client" module, separate from
// the preview entry's plain-data file.
import { useState } from "react";
import { CloseoutChecklist } from "./CloseoutChecklist";
import { EMPTY_CLOSEOUT } from "./CloseoutChecklist.preview.fixtures";

export function CloseoutChecklistDemo({ isClinicalOwner }: { isClinicalOwner: boolean }) {
  const [value, setValue] = useState(EMPTY_CLOSEOUT);
  return (
    <CloseoutChecklist
      value={value}
      onChange={setValue}
      isClinicalOwner={isClinicalOwner}
      approverName="Μ. Ιωάννου"
      approverId="u1"
    />
  );
}
