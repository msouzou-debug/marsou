import type { PreviewEntry } from "@/preview/types";
import { LabelSheet } from "./LabelSheet";

const LABELS = Array.from({ length: 8 }, (_, i) => ({
  assetId: `a${i + 1}`,
  tag: `NGH-HVAC-${String(i + 1).padStart(4, "0")}`,
  nameEl: "Κλιματιστικό οροφής",
  areaNameEl: "Θάλαμος 214",
  url: `https://ecapital.okypy.org.cy/a/NGH-HVAC-${String(i + 1).padStart(4, "0")}`,
}));

const entry: PreviewEntry = {
  id: "label-sheet",
  title: "LabelSheet",
  states: {
    default: () => <LabelSheet labels={LABELS} perPage={6} />,
    loading: () => <LabelSheet state="loading" />,
    empty: () => <LabelSheet labels={[]} />,
    error: () => <LabelSheet state="error" onRetry={() => undefined} />,
  },
  notes:
    "No noPermission/offline: S17b's own screen gates access before this mounts, " +
    "and there is nothing to write here to go offline over. `perPage` is lowered " +
    "to 6 here only so the page split is visible without eight rows; the real " +
    "route uses the 3×8=24 default. The single-QR variant (S17's own preview) " +
    "is exercised in the component's test, not repeated here as a fifth state.",
};

export default entry;
