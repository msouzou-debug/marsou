"use client";

// See area-picker/AreaPicker.preview.demo.tsx's own header comment for why
// the interactive demo lives in its own "use client" module, separate from
// the preview entry's plain-data file.
import { useState } from "react";
import { CloseoutChecklist } from "./CloseoutChecklist";
import { EMPTY_CLOSEOUT } from "./CloseoutChecklist.preview.fixtures";

const SUBMITTED = {
  ...EMPTY_CLOSEOUT,
  barriersRemoved: true,
  areaCleaned: true,
  airBalanceRestored: true,
  systemsTestedAndReturned: true,
  fireSystemsReenabled: true,
  noteEl: "Ο χώρος παραδόθηκε καθαρός.",
};

export function CloseoutChecklistDemo({ readOnly = false }: { readOnly?: boolean }) {
  const [value, setValue] = useState(readOnly ? SUBMITTED : EMPTY_CLOSEOUT);
  return <CloseoutChecklist value={value} onChange={setValue} readOnly={readOnly} />;
}
