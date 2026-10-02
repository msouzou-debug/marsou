// S24 — ADR-0029

import type { PreviewEntry } from "@/preview/types";
import { VendorPickerDemo } from "./VendorPickerDemo";

const entry: PreviewEntry = {
  id: "vendor-picker",
  title: "Vendor picker",
  states: {
    default: () => <VendorPickerDemo mode="results" />,
    loading: () => <VendorPickerDemo mode="pending" />,
    empty: () => <VendorPickerDemo mode="none" />,
    error: () => <VendorPickerDemo mode="failing" />,
    offline: () => <VendorPickerDemo mode="plain" />,
  },
  notes:
    "Type two or more characters. default lists an eligible vendor, a blocked one and an inactive one (both shown, " +
    "neither selectable, with the reason). loading never answers. empty and error leave the plain input working. offline " +
    "stands for «no search available» — without a `search` prop the field is a plain text input. No-permission does " +
    "not apply to a field.",
};

export default entry;
