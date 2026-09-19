// S11a — R19
//
// The wizard's own draft shape. Not the contract's `ShutdownPermitDraft`
// directly: step 1 (Σύστημα) has none of the fields `ShutdownPermitDraft`
// requires yet (areas, dates — see `PermitWizardScreen`'s own header comment
// for the create-on-leaving-step-1 assumption), so this is a superset the
// screen narrows down before each PATCH.
import type { IcraInput, IlsmTrigger, PermitSystem } from "@ecapital/shared";

export interface PermitWizardDraft {
  orgUnitId: string;
  systems: PermitSystem[];
  workKind: IcraInput["workKind"];
  titleEl: string;
  descriptionEl: string;
  projectId: string | null;
  contractId: string | null;
  areaIds: string[];
  plannedStart: string; // datetime-local value, "" until chosen
  plannedEnd: string;
  ilsmTriggers: IlsmTrigger[];
  contingencyPlanEl: string;
}

export const EMPTY_WIZARD_DRAFT: PermitWizardDraft = {
  orgUnitId: "",
  systems: [],
  workKind: "MAINTENANCE",
  titleEl: "",
  descriptionEl: "",
  projectId: null,
  contractId: null,
  areaIds: [],
  plannedStart: "",
  plannedEnd: "",
  ilsmTriggers: [],
  contingencyPlanEl: "",
};

/** Step 1 is complete once there is at least one system, a title and a work kind (always set). */
export function step1Complete(draft: PermitWizardDraft): boolean {
  return draft.systems.length > 0 && draft.titleEl.trim().length >= 3 && draft.orgUnitId !== "";
}

/** Step 2 is complete once at least one area is directly picked (contract `ShutdownPermitDraft.affectedAreaIds` min 1). */
export function step2Complete(draft: PermitWizardDraft): boolean {
  return draft.areaIds.length > 0;
}

/** Step 3 is complete once both ends of the window are set and the end is after the start. */
export function step3Complete(draft: PermitWizardDraft): boolean {
  if (!draft.plannedStart || !draft.plannedEnd) return false;
  return new Date(draft.plannedEnd).getTime() > new Date(draft.plannedStart).getTime();
}

/** Minutes between the two datetimes, or `null` until both are set — S11 step 3 shows the computed duration. */
export function durationMinutes(draft: PermitWizardDraft): number | null {
  if (!draft.plannedStart || !draft.plannedEnd) return null;
  const ms = new Date(draft.plannedEnd).getTime() - new Date(draft.plannedStart).getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}
