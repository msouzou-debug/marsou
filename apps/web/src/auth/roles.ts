// S02a, S03 — R04, R05
//
// Small role checks the UI uses to decide whether to show a write control at
// all, ahead of the API's own 403 (ADR-0010: the database decides who may
// actually write; these mirror that decision in the UI so a role that can
// never succeed is never shown a control that only ever comes back 403 —
// UI instructions §6 "Offline" applies the same idea to write actions: hide
// with a reason, or don't offer, rather than let someone try and fail).
import type { AppRole, DefectSource } from "@ecapital/shared";

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

// S07, S07a, S08 — R08, R10, R31.
//
// FLAGGED (not settled by ADR-0015): the ADR names who *decides* a variation
// (estates_head, admin — CAPEX-01 §10, and the route's own `@Roles` guard)
// and who keeps the contractor register (admin, estates_head write it —
// "Decisions taken 19/09/2026"), but it does not name who may create a
// contract or raise a variation in the first place beyond CAPEX-01 §1's
// prose ("a project engineer raises and submits"). This build takes the
// narrowest reading that still lets the seeded personas work end to end:
// the three roles that actually run a project's works — project_engineer,
// estates_head, admin — may add/edit a contract and may raise a variation on
// one. `technician`, `finance`, `clinical_approver` and the two read-only
// roles cannot. Worth a line in the hand-back summary rather than a guess
// buried in the database layer, which this file does not touch.
const CAN_WRITE_CONTRACTS: AppRole[] = ["project_engineer", "estates_head", "admin"];

export function canWriteContracts(roles: AppRole[]): boolean {
  return roles.some((role) => CAN_WRITE_CONTRACTS.includes(role));
}

/** Same set: raising and submitting a variation is the engineer/estates/admin job (CAPEX-01 §1). */
export function canRaiseVariations(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** RULE (ADR-0015, R10): only a head of estates or an administrator decides — the route's own `@Roles` guard, mirrored here. */
export function canDecideVariations(roles: AppRole[]): boolean {
  return roles.some((role) => role === "estates_head" || role === "admin");
}

/**
 * RULE (ADR-0015, "Who keeps the contractor register", decided 19/09/2026):
 * `admin` and `estates_head` write the register; engineers pick from it.
 * S24 (Ανάδοχοι) itself is gated the same way — a role that cannot write the
 * register also has no reason to be on its page (see hand-back summary).
 */
export function canManageContractors(roles: AppRole[]): boolean {
  return roles.some((role) => role === "admin" || role === "estates_head");
}

// S07b, S07c — R09 (ADR-0017). "A read-only account, or a role that does not
// run projects" is the API's own sentence for these two routes, i.e. the
// same set as `canWriteContracts`: an RFI or a site instruction has no life
// apart from a contract, so whoever runs the contract runs its log.
export const canWriteRfis = canWriteContracts;
export const canWriteSiteInstructions = canWriteContracts;

/**
 * S07d — R12, R35 (ADR-0017 "the first policy that reads a second column").
 * Mirrors `ecapital.can_manage_defect`: the contract/project team may write
 * any defect, and a technician may additionally raise and work one they
 * found themselves — INSPECTION or WORK_ORDER only, never HANDOVER (a
 * contractual position on someone else's work) or CONDITION_SURVEY (an
 * estates exercise). S07d itself only ever offers HANDOVER, so in practice
 * this screen's own «Προσθήκη» is `canWriteContracts` alone; this helper is
 * the general rule for a defect sheet that might show a non-HANDOVER row.
 */
export function canManageDefect(roles: AppRole[], source: DefectSource): boolean {
  if (canWriteContracts(roles)) return true;
  return roles.includes("technician") && (source === "INSPECTION" || source === "WORK_ORDER");
}

// ------------------------------------------------------------ M2 (R13, R14, R16, R18, R31)
//
// FLAGGED (not settled by an ADR the way R10/R15's segregation is): the build
// brief names who *sees* S04's forecast-inputs form ("visible to
// project_engineer/estates_head/admin, read-only otherwise") and who sees
// accruals (finance/admin/estates_head/executive_readonly/auditor_readonly),
// but the API contract does not itself carry a role list for the SAP import,
// the warning dismissal or the budget-lines write. This build takes the
// narrowest reading consistent with the rest of the app: the same three
// roles that run a project's works may set the forecast inputs and dismiss a
// warning on it; finance/admin — the two roles CAPEX-01 §7 already gives
// every ledger to — own the budget lines and the SAP import; a payment
// certificate is created by whoever runs the contract and moves through
// finance from there. Worth a line in the hand-back summary, same as the
// contract-write set above.

/** S04's «Παράμετροι πρόβλεψης» form — read-only for everyone else. */
export function canSetForecastInputs(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** S04's «Απόρριψη» link on a warning line. */
export function canDismissCostWarning(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** S04's «Γραμμές προϋπολογισμού» editor and the finance-only budget rule generally. */
export function canManageBudgetLines(roles: AppRole[]): boolean {
  return roles.some((role) => role === "finance" || role === "admin");
}

/** S10: who may run a SAP import and work its unmatched queue. */
export function canImportSap(roles: AppRole[]): boolean {
  return roles.some((role) => role === "finance" || role === "admin");
}

/** S09: creating a payment certificate is the contract team's job. */
export function canCreatePaymentCert(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** S09's «Έγκριση μηχανικού» — segregation from the creator is enforced by the caller, same pattern as S08. */
export function canApprovePaymentCertEngineer(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** S09's «Παραλαβή από Οικονομικές» and «Εξόφληση». */
export function canProcessPaymentCertFinance(roles: AppRole[]): boolean {
  return roles.some((role) => role === "finance" || role === "admin");
}

/** S09a — explicit in the build brief. */
export function canViewAccruals(roles: AppRole[]): boolean {
  return roles.some((role) =>
    ["finance", "admin", "estates_head", "executive_readonly", "auditor_readonly"].includes(role),
  );
}

/** The «Κόστος» nav entry (Εισαγωγή SAP + Δεδουλευμένα): visible to anyone who can reach either sub-screen. */
export function canViewCostNav(roles: AppRole[]): boolean {
  return canImportSap(roles) || canViewAccruals(roles);
}
