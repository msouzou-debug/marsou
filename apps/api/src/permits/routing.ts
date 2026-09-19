/**
 * The approval route (R22, CAPEX-01 §6.4), as a pure function of the permit.
 *
 * «Approvers derive from the affected areas: Infection Control always for
 * Class III+, ward/department manager for every clinical area touched,
 * Nursing for inpatient areas, Technical Services head always, Hospital
 * Director for anything above a threshold duration or any Class V.»
 *
 * Five lines of brief, six kinds of approver, and three places where it does
 * not say enough. Each of the three is resolved the stricter way — more
 * approvers, never fewer — and each is an ASSUMPTION in ADR-0026:
 *
 *   SAFETY        §6.4 never names it, but §6.3 makes ILSM mandatory and puts
 *                 «notification to the fire officer» in it. A fire officer
 *                 who is notified and has no line to sign is a notification
 *                 nobody can prove happened, so ILSM puts SAFETY on the route.
 *   WARD_MANAGER  §4's `permit_approval.role` has no such value. §6.4 asks for
 *                 one per clinical area, so the enum gains it.
 *   the threshold 72 hours, as `PERMIT_DIRECTOR_THRESHOLD_HOURS`. Lowering it
 *                 only ever adds an approver.
 *
 * Every line the route produces is PENDING and has to be decided. Nothing
 * here decides anything, and nothing here drops a line because the same
 * person would sign two of them — a ward manager who is also the Infection
 * Control officer signs twice, because the two signatures answer different
 * questions.
 */
import type { AreaType, IcraClass, RoutingReason, ApprovalRole } from "@ecapital/shared";
import { classRank } from "../icra/icra-engine";

/** §6.4: «every clinical area touched». These five are the clinical ones. */
export const CLINICAL_AREA_TYPES: AreaType[] = ["THEATRE", "ICU", "WARD", "OPD", "LAB"];

/** §6.4: «Nursing for inpatient areas» — the two with beds in them. */
export const INPATIENT_AREA_TYPES: AreaType[] = ["WARD", "ICU"];

export interface RoutedArea {
  areaId: string;
  areaNameEl: string;
  areaType: AreaType;
}

export interface RoutingFacts {
  icraClass: IcraClass;
  areas: RoutedArea[];
  ilsmRequired: boolean;
  /** plannedEnd − plannedStart, in hours. */
  durationHours: number;
  directorThresholdHours: number;
}

export interface RouteLine {
  role: ApprovalRole;
  reason: RoutingReason;
  areaId: string | null;
  areaNameEl: string | null;
}

/**
 * The route, in the order S13 prints it and S14 reads it: the clinical
 * decisions first, then the technical ones, then the director.
 */
export function routeFor(facts: RoutingFacts): RouteLine[] {
  const lines: RouteLine[] = [];

  // RULE (§6.4): «Infection Control always for Class III+.»
  if (classRank(facts.icraClass) >= classRank("III")) {
    lines.push({
      role: "INFECTION_CONTROL",
      reason: "classThreeOrAbove",
      areaId: null,
      areaNameEl: null,
    });
  }

  // RULE (§6.4): «ward/department manager for every clinical area touched.»
  // One line each — a permit across two theatres needs both of them to say
  // yes, and one manager signing for the other's list is how a theatre finds
  // out on the morning it closes. Areas are taken in the order they were
  // resolved, which puts the direct ones first (§6.1).
  for (const area of facts.areas) {
    if (!CLINICAL_AREA_TYPES.includes(area.areaType)) continue;
    lines.push({
      role: "WARD_MANAGER",
      reason: "clinicalAreaTouched",
      areaId: area.areaId,
      areaNameEl: area.areaNameEl,
    });
  }

  // RULE (§6.4): «Nursing for inpatient areas.» One line for the unit, not
  // one per ward: the Nursing officer answers for the hospital's beds.
  if (facts.areas.some((area) => INPATIENT_AREA_TYPES.includes(area.areaType))) {
    lines.push({
      role: "NURSING",
      reason: "inpatientAreaTouched",
      areaId: null,
      areaNameEl: null,
    });
  }

  // RULE (§6.4): «Technical Services head always.»
  lines.push({ role: "TECHNICAL", reason: "always", areaId: null, areaNameEl: null });

  // ASSUMPTION (§6.3, ADR-0026): ILSM puts the safety officer on the route.
  if (facts.ilsmRequired) {
    lines.push({ role: "SAFETY", reason: "ilsmRequired", areaId: null, areaNameEl: null });
  }

  // RULE (§6.4): «Hospital Director for anything above a threshold duration
  // or any Class V.» One line whichever way it got there; Class V is the
  // reason recorded when both are true, because it is the reason that does
  // not change if somebody shortens the window.
  const classFive = facts.icraClass === "V";
  const tooLong = facts.durationHours > facts.directorThresholdHours;
  if (classFive || tooLong) {
    lines.push({
      role: "HOSPITAL_DIRECTOR",
      reason: classFive ? "classFive" : "durationAboveThreshold",
      areaId: null,
      areaNameEl: null,
    });
  }

  return lines;
}

/** plannedEnd − plannedStart in hours, which is what the threshold compares. */
export function durationHours(start: Date | string, end: Date | string): number {
  const from = start instanceof Date ? start : new Date(start);
  const to = end instanceof Date ? end : new Date(end);
  return (to.getTime() - from.getTime()) / 3_600_000;
}
