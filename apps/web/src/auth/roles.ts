// S02a, S03 — R04, R05
//
// Small role checks the UI uses to decide whether to show a write control at
// all, ahead of the API's own 403 (ADR-0010: the database decides who may
// actually write; these mirror that decision in the UI so a role that can
// never succeed is never shown a control that only ever comes back 403 —
// UI instructions §6 "Offline" applies the same idea to write actions: hide
// with a reason, or don't offer, rather than let someone try and fail).
import type { AppRole } from "@ecapital/shared";

// RULE (ADR-0010, decided 18/09/2026): `auditor_readonly` and
// `executive_readonly` are read-only at the row-policy level — every write
// the API has is refused for both. S02's «Προσθήκη» button and S03's
// «Επεξεργασία» link are hidden (with a tooltip, for «Προσθήκη») for them.
const CANNOT_WRITE_PROJECTS: AppRole[] = ["auditor_readonly", "executive_readonly"];

export function canWriteProjects(roles: AppRole[]): boolean {
  return !roles.some((role) => CANNOT_WRITE_PROJECTS.includes(role));
}

// RULE (R04) plus a flagged extension: ADR-0014 settles who may change
// `approvedBudget` after APPROVED (finance only) but says nothing about who
// may move the phase itself beyond "an administrator may move it
// backwards". `clinical_approver` and `finance` are excluded here as a
// segregation-of-duties call this build makes, not one the ADR states —
// flagged in the hand-back summary rather than guessed into the database
// layer, which this file does not touch.
const CANNOT_CHANGE_PHASE: AppRole[] = ["auditor_readonly", "executive_readonly", "clinical_approver", "finance"];

export function canChangeProjectPhase(roles: AppRole[]): boolean {
  return !roles.some((role) => CANNOT_CHANGE_PHASE.includes(role));
}

export function isAdmin(roles: AppRole[]): boolean {
  return roles.includes("admin");
}
