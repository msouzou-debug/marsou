import type { PreviewEntry } from "@/preview/types";
import { IcraMatrixGrid } from "./IcraMatrixGrid";
import type { IcraActivityType, IcraClass, PatientRiskGroup } from "@ecapital/shared";

const ACTIVITY: IcraActivityType[] = ["A", "B", "C", "D"];
const RISK: PatientRiskGroup[] = ["LOW", "MEDIUM", "HIGH", "HIGHEST"];
const CLASS_BY_ROW: Record<IcraActivityType, IcraClass[]> = {
  A: ["I", "I", "II", "II"],
  B: ["I", "II", "III", "III"],
  C: ["II", "III", "III", "IV"],
  D: ["III", "IV", "IV", "V"],
};
const CELLS = ACTIVITY.flatMap((activityType) =>
  RISK.map((riskGroup, ri) => ({ activityType, riskGroup, icraClass: CLASS_BY_ROW[activityType][ri], controls: [] })),
);

const entry: PreviewEntry = {
  id: "icra-matrix-grid",
  title: "IcraMatrixGrid",
  states: {
    default: () => <IcraMatrixGrid cells={CELLS} activityType="C" riskGroup="HIGH" />,
  },
  notes:
    "State: default only — reference data the caller already has once /icra/evaluate answered. " +
    "The producing cell is highlighted with an ink border, never a purple fill: purple stays " +
    "reserved for IcraBadge and PermitBanner.",
};

export default entry;
