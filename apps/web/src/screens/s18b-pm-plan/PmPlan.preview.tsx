// S18b — R32

import { NoPermission } from "@/components/app-shell";
import { buildMaintenanceContract, buildPmGenerationResult, buildPmSchedule, buildSlaImportResult, buildSlaSystems } from "@/mocks/maintenance";
import { orgUnits } from "@/mocks/org-units";
import type { PreviewEntry } from "@/preview/types";
import { PmPlan, type PmPlanProps } from "./PmPlan";

const done = () => Promise.resolve();

const base: PmPlanProps = {
  orgUnits,
  unitId: orgUnits[0]?.id ?? "",
  onUnitChange: () => undefined,
  state: "default",
  onRetry: () => undefined,
  noPermission: <NoPermission />,
  agreement: buildMaintenanceContract(),
  contractors: [],
  systems: buildSlaSystems(),
  systemsState: "default",
  schedules: [buildPmSchedule()],
  schedulesState: "default",
  assets: [],
  canManage: true,
  onSaveAgreement: done,
  onPatchSystem: done,
  onImport: () => Promise.resolve(buildSlaImportResult()),
  onSaveSchedule: done,
  onGenerate: () => Promise.resolve(buildPmGenerationResult()),
};

const entry: PreviewEntry = {
  id: "s18b-pm-plan",
  title: "S18b Προληπτική συντήρηση",
  states: {
    default: () => <PmPlan {...base} />,
    loading: () => <PmPlan {...base} state="loading" />,
    empty: () => <PmPlan {...base} agreement={null} />,
    error: () => <PmPlan {...base} state="error" />,
    noPermission: () => <PmPlan {...base} state="noPermission" />,
    offline: () => <PmPlan {...base} state="offline" />,
  },
  notes: "Two catalogue rows have null penalty rates, so «Ρήτρες προς επιβεβαίωση» shows (ADR-0031 §2). «empty» is a unit with no agreement yet.",
};

export default entry;
