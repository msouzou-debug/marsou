// S20 — R33 (phone-first: view at 390px)

import { buildMaintenanceContract, buildSlaSystems } from "@/mocks/maintenance";
import { orgUnits } from "@/mocks/org-units";
import type { PreviewEntry } from "@/preview/types";
import { CallForm, type CallFormProps } from "./CallForm";

const base: CallFormProps = {
  orgUnits,
  unitId: orgUnits[0]?.id ?? "",
  onUnitChange: () => undefined,
  assets: [],
  agreement: buildMaintenanceContract(),
  systems: buildSlaSystems(),
  defaultSource: "TECHNICAL_SERVICES",
  readOnly: false,
  submitting: false,
  onSubmit: () => undefined,
  onCancel: () => undefined,
};

const entry: PreviewEntry = {
  id: "s20-call",
  title: "S20 Καταγραφή κλήσης",
  states: {
    default: () => <CallForm {...base} />,
    empty: () => <CallForm {...base} agreement={null} systems={[]} />,
    noPermission: () => <CallForm {...base} readOnly />,
    submitting: () => <CallForm {...base} submitting />,
  },
  notes: "A form: «empty» is a unit with no active agreement (no timers); «noPermission» is the read-only form a role that cannot raise a call sees. Pick a system to see the deadlines preview.",
};

export default entry;
