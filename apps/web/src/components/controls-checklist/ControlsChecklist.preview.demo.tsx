"use client";

// See AreaPicker.preview.demo.tsx's own header comment for why the
// interactive demo lives in its own "use client" module, separate from the
// preview entry's plain-data file.
import { useState } from "react";
import { ControlsChecklist } from "./ControlsChecklist";
import { CONTROLS } from "./ControlsChecklist.preview.fixtures";

export function ControlsChecklistDemo() {
  const [acknowledged, setAcknowledged] = useState<string[]>(["IV-01"]);
  return (
    <ControlsChecklist
      controls={CONTROLS}
      acknowledgedIds={acknowledged}
      onToggle={(id) => setAcknowledged((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
    />
  );
}
