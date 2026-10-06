// S24r — R01, R42

import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { RolesMatrix } from "./RolesMatrix";

const entry: PreviewEntry = {
  id: "s24r-roles",
  title: "S24r Ρόλοι και δικαιώματα",
  states: {
    default: () => <RolesMatrix state="default" onPrint={() => undefined} noPermission={<NoPermission />} />,
    noPermission: () => <RolesMatrix state="noPermission" noPermission={<NoPermission />} />,
  },
  notes:
    "The matrix is static data from @ecapital/shared (ROLE_MATRIX), bundled with the page: nothing is fetched, so loading, empty, error and offline do not arise. Click a role header to highlight its column. Below 1024px the table becomes one card per role; the print view is landscape A4 with the legend and the table.",
};

export default entry;
