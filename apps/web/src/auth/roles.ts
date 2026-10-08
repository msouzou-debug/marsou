// S02a, S03 — R04, R05
//
// Small role checks the UI uses to decide whether to show a write control at
// all, ahead of the API's own 403 (ADR-0010: the database decides who may
// actually write; these mirror that decision in the UI so a role that can
// never succeed is never shown a control that only ever comes back 403 —
// UI instructions §6 "Offline" applies the same idea to write actions: hide
// with a reason, or don't offer, rather than let someone try and fail).
//
// ADR-0033 (owner, 08/10/2026: «The admin should be able to adjust the roles
// and permissions for each role»). Until then every helper below carried its
// own list of roles, a third copy of what the SQL functions and the API's
// `@Roles` already said, and the S24r matrix restated all three. Now the
// matrix is the rule: each helper names one row of it and the least level it
// needs, and `levelAtLeast` reads the matrix the session loaded
// (`./role-matrix-store`). The names and signatures did not change, so no
// screen did either. The row each helper asks is the same row the API's
// `@Needs` and the row policy's `ecapital.allowed` ask for that action.
//
// What is still written out here, and why: `isAdmin`, `canManageApproverScopes`
// and `canViewRoleMatrix` are about who someone is, not about a row of the
// matrix (the user and role screens answer to the administrator's identity),
// and `canManageDefect` keeps ADR-0017's split between a field defect and a
// handover one.
import type { AppRole, DefectSource } from "@ecapital/shared";
import { levelAtLeast } from "./role-matrix-store";

export { getRoleMatrix, levelAtLeast, setRoleMatrix } from "./role-matrix-store";

// RULE (ADR-0010, migration 0002 `can_manage_project`): the project register
// row. By default the administrator, the head of estates and the project
// engineer, and nobody else.
export function canWriteProjects(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "projectRecords", "WRITE");
}

// RULE (R04, ADR-0014): the phase moves forward by whoever holds WRITE on the
// phase row; moving it backwards is MANAGE there, the administrator's by
// default (ProjectsService.changePhase asks the same).
export function canChangeProjectPhase(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "projectPhase", "WRITE");
}

/** Identity, not a row of the matrix: the user and role screens are the administrator's. */
export function isAdmin(roles: AppRole[]): boolean {
  return roles.includes("admin");
}

// S07, S07a, S08 — R08, R10, R31. The contract record row: by default the
// three roles that run a project's works (ADR-0015's reading of CAPEX-01 §1).
export function canWriteContracts(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "contractRecords", "WRITE");
}

/** Raising and submitting a variation (CAPEX-01 §1). */
export function canRaiseVariations(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "variationSubmit", "WRITE");
}

/** RULE (ADR-0015, R10): APPROVE on the decision row — the route's own `@Needs`, mirrored here. */
export function canDecideVariations(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "variationDecide", "APPROVE");
}

/**
 * RULE (ADR-0015, "Who keeps the contractor register", decided 19/09/2026):
 * MANAGE on the contractor row, by default `admin` and `estates_head`; an
 * engineer reads it to pick from. S24 (Ανάδοχοι) itself is gated the same way.
 */
export function canManageContractors(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "contractors", "MANAGE");
}

// S07b, S07c — R09 (ADR-0017). An RFI or a site instruction has no life
// apart from a contract; they share one row of their own.
export function canWriteRfis(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "rfisInstructions", "WRITE");
}

export function canWriteSiteInstructions(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "rfisInstructions", "WRITE");
}

/**
 * S07d — R12, R35 (ADR-0017). Mirrors `ecapital.can_manage_defect`: the
 * defects row, and for a HANDOVER or CONDITION_SURVEY defect — a contractual
 * position on somebody else's work — the contract record row as well. That
 * is why a technician, who has the first by default and not the second,
 * raises the defects they find on an inspection or a work order and no
 * others. S07d only ever offers HANDOVER.
 */
export function canManageDefect(roles: AppRole[], source: DefectSource): boolean {
  if (!levelAtLeast(roles, "defects", "WRITE")) return false;
  return source === "INSPECTION" || source === "WORK_ORDER" || levelAtLeast(roles, "contractRecords", "WRITE");
}

// ------------------------------------------------------------ M2 (R13, R14, R16, R18, R31)

/** S04's «Παράμετροι πρόβλεψης» form — read-only for everyone else. */
export function canSetForecastInputs(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "forecastWarnings", "WRITE");
}

/** S04's «Απόρριψη» link on a warning line. */
export function canDismissCostWarning(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "forecastWarnings", "WRITE");
}

/** S04's «Γραμμές προϋπολογισμού» editor and the finance-only budget rule generally. */
export function canManageBudgetLines(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "budgetLines", "WRITE");
}

/** S10: who may run a SAP import and work its unmatched queue. */
export function canImportSap(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "sapImport", "WRITE");
}

/** S09: creating a payment certificate. */
export function canCreatePaymentCert(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "paymentCertCreate", "WRITE");
}

/** S09's «Έγκριση μηχανικού» — segregation from the creator is enforced by the caller, same pattern as S08. */
export function canApprovePaymentCertEngineer(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "paymentCertEngineer", "APPROVE");
}

/** S09's «Παραλαβή από Οικονομική Διεύθυνση» and «Εξόφληση». */
export function canProcessPaymentCertFinance(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "paymentCertFinance", "APPROVE");
}

/** S09a — the accruals row. The API answers 403 by `@Needs` below READ. */
export function canViewAccruals(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "accruals", "READ");
}

/** The «Κόστος» nav entry (Εισαγωγή SAP + Δεδουλευμένα): shown when either row is not NONE. */
export function canViewCostNav(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "sapImport", "READ") || canViewAccruals(roles);
}

// ------------------------------------------------------------ M3 (R19–R25)

/** S11/S11a: raise or edit a shutdown request. */
export function canWritePermits(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "permitRequest", "WRITE");
}

/** Permit detail's «Έναρξη εργασιών» and «Κλείσιμο». */
export function canOperatePermit(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "permitOperate", "WRITE");
}

/** Permit detail's «Απόρριψη» — RULE (CAPEX-01 §10 precedent): APPROVE on the request row. */
export function canRejectPermit(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "permitRequest", "APPROVE");
}

/** S24's «Χώροι και ρόλοι έγκρισης» editor — identity, like the rest of S24. */
export function canManageApproverScopes(roles: AppRole[]): boolean {
  return isAdmin(roles);
}

// ------------------------------------------------------------ M4 (R26–R30, R45)

/** S16a «Προσθήκη», S17a's writable form, S17's «Επεξεργασία» link. */
export function canWriteAssets(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "assetRegister", "WRITE");
}

/** S17's «Καταγραφή κατάστασης» and «Μετρήσεις» add form — the technician by default too. */
export function canRecordAssetCondition(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "assetCondition", "WRITE");
}

/** S17's «Έγγραφα» upload sheet (CAPEX-01 §4: filed papers, not a field record). */
export function canUploadAssetDocuments(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "assetDocuments", "WRITE");
}

/** S17c replacement forecast. */
export function canViewReplacementForecast(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "assetForecast", "READ");
}

// ------------------------------------------------------------ M5 (R32–R37)

/**
 * S20 «Νέα κλήση». By default the clinical approver may raise a corrective
 * call too (owner answer, 06/10/2026) and does nothing more with it.
 */
export function canRaiseWorkOrder(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "workOrderRaise", "WRITE");
}

/** S18a/S19 transitions, codes, costs, extensions, notes and photos. */
export function canWorkWorkOrder(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "workOrderWork", "WRITE");
}

/** S18b: the agreement, the SLA catalogue, its import, the programme and «Έκδοση τώρα». */
export function canManageMaintenanceContract(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "maintenanceAgreement", "MANAGE");
}

/** S21 write, and S18a «Στις εκκρεμότητες». */
export function canManageBacklog(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "backlog", "WRITE");
}

/** S21 «Σε έργο»: drafts and funds a project. */
export function canFundBacklog(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "backlogToProject", "APPROVE");
}

/**
 * S22. RULE (ADR-0031 §10): «everyone who reads the unit reads all of it» —
 * READ for every role by default. The helper exists so the S18 button and the
 * page ask one place.
 */
export function canViewScorecard(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "scorecard", "READ");
}

// ------------------------------------------------------------ M6 (R39)

/**
 * S23 «Αναφορές» and every `/reports/<slug>`. RULE (ADR-0032 §6): by default
 * the board and management set of CAPEX-01 §11. The API answers 403 by
 * `@Needs("reports", "READ")`; the nav item and the pages ask here first.
 */
export function canViewReports(roles: AppRole[]): boolean {
  return levelAtLeast(roles, "reports", "READ");
}

// ------------------------------------------------------------ S24r

/**
 * S24r «Ρόλοι και δικαιώματα». Owner ask (06/10/2026): the administrator,
 * who hands out roles, and the head of estates, who is asked what a role
 * gets. Identity, not a row: the page is where the matrix is changed, so it
 * cannot itself be a cell of it.
 */
export function canViewRoleMatrix(roles: AppRole[]): boolean {
  return isAdmin(roles) || roles.includes("estates_head");
}
