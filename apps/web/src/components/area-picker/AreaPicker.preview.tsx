import type { PreviewEntry } from "@/preview/types";
import { AreaPicker } from "./AreaPicker";
import { AreaPickerDemo } from "./AreaPicker.preview.demo";
import { TREE } from "./AreaPicker.preview.fixtures";

const entry: PreviewEntry = {
  id: "area-picker",
  title: "AreaPicker",
  states: {
    default: () => <AreaPickerDemo />,
    loading: () => <AreaPicker areaTree={TREE} selectedAreaIds={["a1"]} onToggle={() => undefined} indirectAreas={[]} loadingIndirect />,
    empty: () => (
      <AreaPicker areaTree={{ orgUnitId: "unit-1", buildings: [] }} selectedAreaIds={[]} onToggle={() => undefined} />
    ),
  },
  notes:
    "Loading applies only to the indirect-areas half, computed by /areas/impact; the tree itself " +
    "is reference data the caller already has. Error/noPermission/offline belong to the wizard step " +
    "around this picker.",
};

export default entry;
