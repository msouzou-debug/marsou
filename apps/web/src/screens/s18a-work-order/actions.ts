// S18a, S19 — R33, R34 (ADR-0031 §3, §6)
//
// Which actions an order offers, and what each needs before it may go. Pure,
// so S18a's buttons, S19's bottom bar and the tests read the same rule.
import {
  WORK_ORDER_TRANSITIONS,
  type CauseCode,
  type FailureCode,
  type RemedyCode,
  type WorkOrderAction,
  type WorkOrderKind,
  type WorkOrderStatus,
} from "@ecapital/shared";

/**
 * RULE (contract `WORK_ORDER_TRANSITIONS`, `WorkOrderStatus` comment): the
 * API's own transition table, narrowed by kind. A PM order runs OPEN →
 * IN_PROGRESS → COMPLETED: there is no contractor response to acknowledge
 * and no breakdown to restore, so ACKNOWLEDGE and RESTORE are not offered
 * on it. A role that cannot work orders gets nothing at all.
 */
export function availableActions(status: WorkOrderStatus, kind: WorkOrderKind, canWork: boolean): WorkOrderAction[] {
  if (!canWork) return [];
  const allowed = WORK_ORDER_TRANSITIONS[status];
  if (kind !== "PM") return allowed;
  return allowed.filter((action) => action !== "ACKNOWLEDGE" && action !== "RESTORE");
}

/** RULE (ADR-0031 §6): a corrective order cannot complete without all three codes. */
export function needsCodes(kind: WorkOrderKind): boolean {
  return kind === "CORRECTIVE";
}

export interface CompleteCodes {
  failureCode: FailureCode | "";
  causeCode: CauseCode | "";
  remedyCode: RemedyCode | "";
}

export function codesComplete(codes: CompleteCodes): boolean {
  return codes.failureCode !== "" && codes.causeCode !== "" && codes.remedyCode !== "";
}

export const FAILURE_CODES: FailureCode[] = [
  "NO_OUTPUT",
  "DEGRADED",
  "LEAK",
  "NOISE_VIBRATION",
  "ELECTRICAL_FAULT",
  "CONTROL_FAULT",
  "ALARM",
  "DAMAGE",
  "OTHER",
];
export const CAUSE_CODES: CauseCode[] = ["WEAR", "LACK_OF_PM", "MISUSE", "POWER_SUPPLY", "ENVIRONMENT", "DESIGN", "EXTERNAL", "UNKNOWN"];
export const REMEDY_CODES: RemedyCode[] = [
  "REPAIR",
  "REPLACE_PART",
  "REPLACE_UNIT",
  "ADJUST",
  "CLEAN",
  "RESET",
  "TEMPORARY_FIX",
  "NO_FAULT_FOUND",
];

/** An order nobody can move on any more. */
export function isClosed(status: WorkOrderStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

/** A `<input type="date">` value to the ISO instant the contract's `.datetime()` fields want: noon Nicosia, so no zone moves the day. */
export function dateInputToIso(value: string): string {
  return new Date(`${value}T12:00:00+03:00`).toISOString();
}
