// S24r — R01, R42 (ADR-0033)

import { ROLE_MATRIX } from "@ecapital/shared";
import { NoPermission } from "@/components/app-shell";
import type { PreviewEntry } from "@/preview/types";
import { RolesMatrix } from "./RolesMatrix";

const entry: PreviewEntry = {
  id: "s24r-roles",
  title: "S24r Ρόλοι και δικαιώματα",
  states: {
    // The administrator's view: every free cell is a list, the guardrailed
    // ones are locked. Saving here answers with the defaults after a pause,
    // the way the API answers with the stored matrix.
    default: () => (
      <RolesMatrix
        state="default"
        editable
        onPrint={() => undefined}
        onSave={() => new Promise((resolve) => setTimeout(() => resolve(ROLE_MATRIX), 400))}
        onReset={() => new Promise((resolve) => setTimeout(() => resolve(ROLE_MATRIX), 400))}
        noPermission={<NoPermission />}
      />
    ),
    noPermission: () => <RolesMatrix state="noPermission" noPermission={<NoPermission />} />,
  },
  notes:
    "ADR-0033: the matrix arrives with the page (GET /admin/roles/permissions, read by the server), so loading, empty and offline do not arise for the table; a refused save shows the API's sentence in the save bar. The head of estates sees the same table read only. Click a role header to highlight its column. Below 1024px the table becomes one card per role, read only; the print view is landscape A4 with the legend and the table.",
};

export default entry;
