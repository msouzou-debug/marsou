// S02a, S03 — R04, R05
//
// Small role checks the UI uses to decide whether to show a write control at
// all, ahead of the API's own 403 (ADR-0010: the database decides who may
// actually write; these mirror that decision in the UI so a role that can
// never succeed is never shown a control that only ever comes back 403 —
// UI instructions §6 "Offline" applies the same idea to write actions: hide
// with a reason, or don't offer, rather than let someone try and fail).
import type { AppRole, DefectSource } from "@ecapital/shared";

// RULE (ADR-0010, migration 0002 `can_manage_project`): a project is written
// by the administrator, the head of estates and the project engineer, and by
// nobody else. Until 06/10/2026 this helper only excluded the two read-only
// roles, so a technician, finance or a clinical approver saw «Προσθήκη» and
// the database then refused the save. The roles table (S24r) made the gap
// visible; the helper now says what the row policy says.
const CAN_WRITE_PROJECTS: AppRole[] = ["admin", "estates_head", "project_engineer"];

export function canWriteProjects(roles: AppRole[]): boolean {
  return roles.some((role) => CAN_WRITE_PROJECTS.includes(role));
}

// RULE (R04, ADR-0014): the phase moves forward by whoever may write the
// project; only an administrator may move it backwards. Same three roles as
// above, for the same reason.
export function canChangeProjectPhase(roles: AppRole[]): boolean {
  return canWriteProjects(roles);
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

/** S09's «Παραλαβή από Οικονομική Διεύθυνση» and «Εξόφληση». */
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

// ------------------------------------------------------------ M3 (R19–R25)
//
// FLAGGED (not settled by an ADR): CAPEX-01 §6 names who runs the flow in
// prose ("Engineer picks systems…") but the API contract carries no role
// list of its own for these routes. This build takes the same narrowest
// reading the M1/M2 helpers above take: the three roles that run a project's
// works may raise, edit and start/close a shutdown request;
// `estates_head`/`admin` may reject one (CAPEX-01 §10's segregation for a
// variation is the closest precedent — the person who decides is not the
// person who asked); a `clinical_approver` only ever decides their own
// routed approval line, never these lifecycle actions. Worth a line in the
// hand-back summary, same as the contract-write set above.

/** S11/S11a: raise or edit a shutdown request. */
export function canWritePermits(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** Permit detail's «Έναρξη εργασιών» and «Κλείσιμο». */
export function canOperatePermit(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** Permit detail's «Απόρριψη» — RULE (CAPEX-01 §10 precedent): estates_head or admin only. */
export function canRejectPermit(roles: AppRole[]): boolean {
  return roles.some((role) => role === "estates_head" || role === "admin");
}

/** S24's «Χώροι και ρόλοι έγκρισης» editor — admin only, the rest of S24 already is. */
export function canManageApproverScopes(roles: AppRole[]): boolean {
  return isAdmin(roles);
}

// ------------------------------------------------------------ M4 (R26–R30, R45)
//
// FLAGGED (not settled by an ADR): the owner steer (20/09/2026) fixes the
// M4 scope but not a role list of its own; the build brief's own instruction
// ("engineer/estates_head/admin write; technician sees the form read-only
// except condition") is the only role text M4 gives. This build takes that
// literally and extends it the same narrow way the M1–M3 helpers above do:
// the three roles that already run a project's works own the register and
// its form; a technician — the role that actually stands in front of the
// asset with a scanned QR — may record a condition reading and a meter
// reading, never edit the record itself; the forecast is read by the same
// finance-adjacent roles CAPEX-01 §7 already gives every ledger to. Worth a
// line in the hand-back summary, same as the contract-write set above.

/** S16a «Προσθήκη», S17a's writable form, S17's «Επεξεργασία» link. */
export function canWriteAssets(roles: AppRole[]): boolean {
  return canWriteContracts(roles);
}

/** S17's «Καταγραφή κατάστασης» and «Μετρήσεις» add form — technician and up. */
export function canRecordAssetCondition(roles: AppRole[]): boolean {
  return canWriteAssets(roles) || roles.includes("technician");
}

/** S17's «Έγγραφα» upload sheet — the register-writing roles, not the technician (CAPEX-01 §4: filed papers, not a field record). */
export function canUploadAssetDocuments(roles: AppRole[]): boolean {
  return canWriteAssets(roles);
}

/** S17c replacement forecast — explicit in the build brief item 6. */
export function canViewReplacementForecast(roles: AppRole[]): boolean {
  return roles.some((role) => ["estates_head", "finance", "executive_readonly", "admin"].includes(role));
}

// ------------------------------------------------------------ M5 (R32–R37)
//
// ADR-0031 §10 settles these, so unlike the M1–M4 blocks above nothing here
// is a guess. The API's row policies and `@Roles` decide; these only keep a
// control off the screen for a role that would get a 403.

/**
 * S20 «Νέα κλήση». The nursing team is who notices a fault on a ward, so
 * the clinical approver may raise a corrective call too (owner answer,
 * 06/10/2026). Raising is all they do: they never move an order on.
 */
export function canRaiseWorkOrder(roles: AppRole[]): boolean {
  return roles.some((role) =>
    ["technician", "project_engineer", "estates_head", "admin", "clinical_approver"].includes(role),
  );
}

/** S18a/S19 transitions, codes, costs, extensions, notes and photos. */
export function canWorkWorkOrder(roles: AppRole[]): boolean {
  return roles.some((role) => ["technician", "project_engineer", "estates_head", "admin"].includes(role));
}

/** S18b: the agreement, the SLA catalogue, its import, the programme and «Έκδοση τώρα». */
export function canManageMaintenanceContract(roles: AppRole[]): boolean {
  return roles.some((role) => role === "estates_head" || role === "admin");
}

/** S21 write, and S18a «Στις εκκρεμότητες»: engineer, head of estates, admin. */
export function canManageBacklog(roles: AppRole[]): boolean {
  return roles.some((role) => ["project_engineer", "estates_head", "admin"].includes(role));
}

/** S21 «Σε έργο»: drafts and funds a project, so only the two roles that may. */
export function canFundBacklog(roles: AppRole[]): boolean {
  return roles.some((role) => role === "estates_head" || role === "admin");
}

/**
 * S22. RULE (ADR-0031 §10): «everyone who reads the unit reads all of it» —
 * the scorecard is computed from orders the caller already sees, so there
 * is no role to keep out. The helper exists so the S18 button and the page
 * ask one place, should that ever change.
 */
export function canViewScorecard(roles: AppRole[]): boolean {
  return roles.length > 0;
}

// ------------------------------------------------------------ M6 (R39)

/**
 * S23 «Αναφορές» and every `/reports/<slug>`. RULE (ADR-0032 §6): the head
 * of estates, finance, the executive, the auditor and the administrator,
 * the board and management set of CAPEX-01 §11. The API answers 403 by
 * `@Roles` to anyone else; the nav item and the pages ask here first, so an
 * engineer or a technician is never shown a page that can only refuse them.
 */
export function canViewReports(roles: AppRole[]): boolean {
  return roles.some((role) => ["admin", "estates_head", "finance", "executive_readonly", "auditor_readonly"].includes(role));
}

// ------------------------------------------------------------ S24r

/**
 * S24r «Ρόλοι και δικαιώματα». Owner ask (06/10/2026): the administrator,
 * who hands out roles, and the head of estates, who is asked what a role
 * gets. The page only reads the static matrix in `@ecapital/shared`
 * (`ROLE_MATRIX`), so no API route is behind it.
 */
export function canViewRoleMatrix(roles: AppRole[]): boolean {
  return isAdmin(roles) || roles.includes("estates_head");
}
