/**
 * The ICRA 2.0 engine (R20), as pure functions of a matrix version and a set
 * of areas. No database, no request, no clock — so every rule in CAPEX-01
 * §6.2 can be pinned by a unit test, and so the wizard, the permit and the
 * seed all get the same answer from the same code.
 *
 * CAPEX-01 §2 (the ASHE ICRA 2.0 row) and §6.2 between them state four rules,
 * and all four live here:
 *
 *   1. the patient risk group is the highest of all affected areas — direct
 *      and indirect alike — and of the surrounding areas;
 *   2. the class comes from the ACTIVE matrix version, never from code;
 *   3. Class III and above needs a printed permit;
 *   4. Class II is invalid for construction or renovation and the wizard
 *      must refuse it.
 *
 * The fifth — «Type C in a high-risk area is Class IV, not III» — is not a
 * rule of this file at all. It is a cell of the matrix, because the matrix is
 * reference data ΟΚΥπΥ Infection Control owns (§6.2). `src/db/seed-data.ts`
 * is where it is written down and `icra-engine.test.ts` is where it is
 * checked, cell by cell.
 */
import type {
  IcraActivityType,
  IcraControl,
  IcraInput,
  IcraMatrixCell,
  IcraMatrixVersion,
  IcraResult,
  PatientRiskGroup,
  SurroundingArea,
} from "@ecapital/shared";

/** ICRA 2.0 Table 2, worst last. The order is the comparison. */
export const RISK_ORDER: PatientRiskGroup[] = ["LOW", "MEDIUM", "HIGH", "HIGHEST"];

/** ICRA 2.0 Table 3, mildest first. «Class III and above» is an index test. */
export const CLASS_ORDER = ["I", "II", "III", "IV", "V"] as const;

export function riskRank(group: PatientRiskGroup): number {
  return RISK_ORDER.indexOf(group);
}

export function classRank(icraClass: IcraResult["icraClass"]): number {
  return CLASS_ORDER.indexOf(icraClass);
}

/** An area the permit touches, as much of it as the engine needs. */
export interface RiskCandidate {
  /** The area id, or `surrounding:<SIDE>` for a side with no area picked. */
  id: string;
  patientRiskGroup: PatientRiskGroup;
}

/**
 * RULE (§6.2): «patient risk group (highest of all affected areas)», and §6.1
 * says an indirect area «counts for routing and for the ICRA risk group
 * exactly like a direct one». The surrounding-area assessment — above, below,
 * lateral, behind, in front — joins the same maximum.
 *
 * The winner is the first candidate at the highest band, and affected areas
 * are offered before surrounding ones, so a theatre the engineer picked is
 * what the screen names rather than the theatre above it. Ties do not change
 * the answer, only the sentence explaining it.
 */
export function highestRisk(candidates: RiskCandidate[]): RiskCandidate {
  if (!candidates.length) {
    throw new Error("highestRisk needs at least one area");
  }
  let winner = candidates[0];
  for (const candidate of candidates) {
    if (riskRank(candidate.patientRiskGroup) > riskRank(winner.patientRiskGroup)) {
      winner = candidate;
    }
  }
  return winner;
}

/**
 * The surrounding assessment as risk candidates.
 *
 * A side with an area on it carries that area's band. A side with no area but
 * a band typed against it still counts — the assessor looked above the
 * ceiling and said what is up there — and is named `surrounding:<SIDE>`,
 * because there is no area id to name and dropping the band would be the
 * looser reading of a clinical-safety rule. A side with neither is nothing.
 */
export function surroundingCandidates(surrounding: SurroundingArea[]): RiskCandidate[] {
  return surrounding
    .filter((side): side is SurroundingArea & { patientRiskGroup: PatientRiskGroup } =>
      side.patientRiskGroup !== null,
    )
    .map((side) => ({
      id: side.areaId ?? `surrounding:${side.side}`,
      patientRiskGroup: side.patientRiskGroup,
    }));
}

export function cellFor(
  matrix: IcraMatrixVersion,
  activityType: IcraActivityType,
  riskGroup: PatientRiskGroup,
): IcraMatrixCell {
  const cell = matrix.cells.find(
    (c) => c.activityType === activityType && c.riskGroup === riskGroup,
  );
  // 4 × 4 = 16 cells, and a version with a hole in it is a version that would
  // quietly refuse to produce a class for somebody standing in a theatre.
  if (!cell) {
    throw new Error(
      `ICRA matrix ${matrix.id} has no cell for activity ${activityType} × ${riskGroup}`,
    );
  }
  return cell;
}

export type WorkKind = IcraInput["workKind"];

export interface IcraEvaluation {
  activityType: IcraActivityType;
  workKind: WorkKind;
  /** Every affected area, direct and indirect (§6.1). */
  areas: RiskCandidate[];
  surrounding: SurroundingArea[];
  matrix: IcraMatrixVersion;
}

/** §6.2: the wizard must refuse Class II for these two kinds of work. */
export const WORKS_KINDS: WorkKind[] = ["CONSTRUCTION", "RENOVATION"];

export function evaluate(input: IcraEvaluation): IcraResult {
  const candidates = [...input.areas, ...surroundingCandidates(input.surrounding)];
  const winner = highestRisk(candidates);
  const cell = cellFor(input.matrix, input.activityType, winner.patientRiskGroup);

  return {
    // RULE (§6.2): the evaluation always records which edition of the matrix
    // answered it. A permit decided under 2026.1 has to keep reading as it
    // was decided after Infection Control publishes 2026.2.
    matrixVersionId: input.matrix.id,
    activityType: input.activityType,
    riskGroup: winner.patientRiskGroup,
    riskGroupFromAreaId: winner.id,
    icraClass: cell.icraClass,
    controls: cell.controls,
    // RULE (§6.2): «Class III and above generates a printable permit with the
    // mandatory control checklist.»
    permitRequired: classRank(cell.icraClass) >= classRank("III"),
    // RULE (§6.2, §2): «Class II is never valid for construction or
    // renovation.» The engine answers with the cell it found and this key;
    // the wizard shows the sentence and disables Υποβολή, and the API refuses
    // the submission with 422 rather than storing it.
    refusalKey:
      cell.icraClass === "II" && WORKS_KINDS.includes(input.workKind)
        ? "classTwoInvalidForWorks"
        : null,
  };
}

/** Every control id of a cell, for the «acknowledged them all» check (UI S12). */
export function controlIds(controls: IcraControl[]): string[] {
  return controls.map((control) => control.id);
}

/**
 * RULE (UI §5 S12): «each item has an Ενημερώθηκα checkbox that must all be
 * ticked before Υποβολή enables». The browser enables a button; the API is
 * what makes it true, so the same list is checked again on the way in.
 */
export function missingAcknowledgements(
  controls: IcraControl[],
  acknowledged: string[],
): string[] {
  const seen = new Set(acknowledged);
  return controlIds(controls).filter((id) => !seen.has(id));
}
