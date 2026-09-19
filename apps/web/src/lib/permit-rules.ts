// M3 (R19–R25) — pure rules shared by the shutdown/permit screens, unit
// tested here once instead of re-derived inside each component (the same
// split `src/components/sla-chip/SlaChip.tsx`'s `slaState` uses).

import type { CalendarEntry, CloseoutChecklist, IcraControl, PermitStatus, ShutdownPermit } from "@ecapital/shared";
import type { PermitState } from "@/components/permit-banner";
import type { TimelineEntry } from "@/components/timeline";

/**
 * S12 step 3, "Κατηγορία" — RULE: every control must be acknowledged before
 * Υποβολή enables (UI instructions §5 S12).
 */
export function allControlsAcknowledged(controls: IcraControl[], acknowledgedIds: string[]): boolean {
  if (controls.length === 0) return false;
  const acknowledged = new Set(acknowledgedIds);
  return controls.every((control) => acknowledged.has(control.id));
}

/**
 * S11 step 2, "Χώροι που επηρεάζονται" — RULE: an indirect area (downstream
 * of a picked system) is not removable; only a directly picked area is
 * (UI instructions §5 S11, contract `AffectedArea.impact`).
 */
export function canRemoveArea(impact: "DIRECT" | "INDIRECT"): boolean {
  return impact === "DIRECT";
}

/**
 * Permit detail, «Έναρξη εργασιών» — RULE: only enabled inside the planned
 * window (UI instructions §5 permit detail). Returns the disabled reason key
 * (for the button's `title`) or `null` when the action is allowed.
 */
export function startWorkDisabledReasonKey(
  status: PermitStatus,
  plannedStart: string,
  plannedEnd: string,
  now: Date,
): "notApproved" | "beforeWindow" | "afterWindow" | null {
  if (status !== "APPROVED") return "notApproved";
  const start = new Date(plannedStart).getTime();
  const end = new Date(plannedEnd).getTime();
  const t = now.getTime();
  if (t < start) return "beforeWindow";
  if (t > end) return "afterWindow";
  return null;
}

/**
 * Permit detail closeout — RULE (§6.6): no closeout, no permit closure.
 * Every box must be true and the clinical owner must have signed.
 */
export function closeoutComplete(checklist: CloseoutChecklist): boolean {
  return (
    checklist.barriersRemoved &&
    checklist.areaCleaned &&
    checklist.airBalanceRestored &&
    checklist.systemsTestedAndReturned &&
    checklist.fireSystemsReenabled &&
    checklist.clinicalAcceptanceById !== null
  );
}

/** Permit detail banner — maps the contract's eight-value status onto the four PermitBanner states, per the task's own mapping. */
export function permitBannerState(status: PermitStatus): PermitState | null {
  switch (status) {
    case "CLINICAL_REVIEW":
    case "SUBMITTED":
      return "pendingApproval";
    case "APPROVED":
    case "ACTIVE":
      return "inForce";
    case "BREACH":
      return "expired";
    case "REJECTED":
      return "revoked";
    case "CLOSED":
    case "DRAFT":
      return null; // RULE: CLOSED shows a closed summary line, no banner; DRAFT is not yet a permit.
  }
}

/**
 * Permit detail's Timeline — the contract carries no `audit_log` rows of its
 * own for a permit (unlike a project's `ProjectDetail.audit`), so this
 * derives a read-only trail from the lifecycle fields `ShutdownPermit`
 * already has: requested, submitted, each approval decided, breached,
 * closed. ASSUMPTION, flagged for the PM: a `GET /permits/:id/audit` (the
 * pattern every other record page uses) would replace this once it exists.
 */
export function permitTimelineFrom(
  permit: ShutdownPermit,
  actionLabel: (key: "requested" | "submitted" | "approved" | "returned" | "rejected" | "breached" | "closed") => string,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { id: "requested", actor: permit.requestedByName, action: actionLabel("requested"), timestamp: permit.requestedAt },
  ];
  if (permit.submittedAt) {
    entries.push({ id: "submitted", actor: permit.requestedByName, action: actionLabel("submitted"), timestamp: permit.submittedAt });
  }
  for (const approval of permit.approvals) {
    if (!approval.decidedAt) continue;
    const key = approval.decision === "APPROVED" ? "approved" : approval.decision === "RETURNED" ? "returned" : "rejected";
    entries.push({
      id: `approval-${approval.id}`,
      actor: approval.approverName ?? "",
      action: actionLabel(key),
      timestamp: approval.decidedAt,
      diff: approval.commentEl ?? undefined,
    });
  }
  if (permit.breachedAt) {
    entries.push({ id: "breached", actor: "", action: actionLabel("breached"), timestamp: permit.breachedAt });
  }
  if (permit.closedAt) {
    entries.push({ id: "closed", actor: permit.closeout?.clinicalAcceptanceByName ?? "", action: actionLabel("closed"), timestamp: permit.closedAt });
  }
  return entries;
}

/**
 * S15 calendar — RULE (§6.7): a clash is a warning, never a block. This only
 * says which other permit to name in the tooltip.
 */
export function clashPartnerRef(entry: CalendarEntry, all: CalendarEntry[]): string | null {
  if (!entry.hasClash) return null;
  const overlapping = all.find(
    (other) =>
      other.permitId !== entry.permitId &&
      other.orgUnitId === entry.orgUnitId &&
      new Date(other.start) < new Date(entry.end) &&
      new Date(entry.start) < new Date(other.end),
  );
  return overlapping?.permitRef ?? null;
}
