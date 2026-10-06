import { z } from "zod";
import type { AppRole } from "./auth";
import { ROLE_SCOPE, type RoleScope } from "./roles";

/**
 * S24r «Ρόλοι και δικαιώματα» — what each of the eight roles sees and does.
 *
 * Static data, not an API answer: the rules themselves live in the API's
 * `@Roles` guards and row policies (ADR-0010), and the web helpers in
 * `apps/web/src/auth/roles.ts` mirror them. This table restates them in one
 * place for people to read. `apps/web/src/auth/role-matrix.test.ts` checks
 * every row against the helper that decides it, so the table cannot drift
 * from what the screens actually allow.
 *
 * The five levels, lowest first:
 *
 *   NONE     the area is not shown to the role at all
 *   READ     sees it, changes nothing
 *   WRITE    creates and edits records
 *   APPROVE  decides: approves, rejects, pays, funds
 *   MANAGE   full control, including the settings the area runs on
 *
 * A higher level includes the lower ones for the same row.
 */
export const AccessLevel = z.enum(["NONE", "READ", "WRITE", "APPROVE", "MANAGE"]);
export type AccessLevel = z.infer<typeof AccessLevel>;

export const ACCESS_RANK: Record<AccessLevel, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  APPROVE: 3,
  MANAGE: 4,
};

/** True when `level` is `min` or higher. */
export function atLeast(level: AccessLevel, min: AccessLevel): boolean {
  return ACCESS_RANK[level] >= ACCESS_RANK[min];
}

/** The row groups, in the order the screen shows them (the nav's own order). */
export const MatrixGroup = z.enum([
  "portfolio",
  "projects",
  "contracts",
  "cost",
  "permits",
  "assets",
  "maintenance",
  "reports",
  "admin",
  "audit",
]);
export type MatrixGroup = z.infer<typeof MatrixGroup>;

/** One row of the matrix. Labels are i18n keys under `screens.s24roles.areas`. */
export const MatrixArea = z.enum([
  "portfolio",
  // Έργα
  "projectRecords",
  "projectPhase",
  "approvedBudget",
  // Συμβάσεις
  "contractRecords",
  "rfisInstructions",
  "variationSubmit",
  "variationDecide",
  "defects",
  "paymentCertCreate",
  "paymentCertEngineer",
  "paymentCertFinance",
  // Κόστος
  "sapImport",
  "budgetLines",
  "accruals",
  "forecastWarnings",
  // Διακοπές και άδειες
  "permitRequest",
  "permitClinical",
  "permitOperate",
  "permitCalendar",
  // Πάγια
  "assetRegister",
  "assetCondition",
  "assetDocuments",
  "assetForecast",
  "assetLabels",
  // Συντήρηση
  "workOrderRaise",
  "workOrderWork",
  "maintenanceAgreement",
  "backlog",
  "backlogToProject",
  "scorecard",
  // Αναφορές
  "reports",
  // Διαχείριση
  "users",
  "contractors",
  "efinance",
  // Ίχνος ελέγχου
  "auditTrail",
]);
export type MatrixArea = z.infer<typeof MatrixArea>;

export const MATRIX_GROUPS: ReadonlyArray<{ group: MatrixGroup; areas: readonly MatrixArea[] }> = [
  { group: "portfolio", areas: ["portfolio"] },
  { group: "projects", areas: ["projectRecords", "projectPhase", "approvedBudget"] },
  {
    group: "contracts",
    areas: [
      "contractRecords",
      "rfisInstructions",
      "variationSubmit",
      "variationDecide",
      "defects",
      "paymentCertCreate",
      "paymentCertEngineer",
      "paymentCertFinance",
    ],
  },
  { group: "cost", areas: ["sapImport", "budgetLines", "accruals", "forecastWarnings"] },
  { group: "permits", areas: ["permitRequest", "permitClinical", "permitOperate", "permitCalendar"] },
  { group: "assets", areas: ["assetRegister", "assetCondition", "assetDocuments", "assetForecast", "assetLabels"] },
  {
    group: "maintenance",
    areas: ["workOrderRaise", "workOrderWork", "maintenanceAgreement", "backlog", "backlogToProject", "scorecard"],
  },
  { group: "reports", areas: ["reports"] },
  { group: "admin", areas: ["users", "contractors", "efinance"] },
  { group: "audit", areas: ["auditTrail"] },
];

/**
 * The column order: the roles that run the estate first, the read-only two
 * after them, the administrator last — the same order the manual's «Οι
 * ρόλοι» lists them in.
 */
export const MATRIX_ROLES: readonly AppRole[] = [
  "estates_head",
  "project_engineer",
  "technician",
  "finance",
  "clinical_approver",
  "executive_readonly",
  "auditor_readonly",
  "admin",
];

type Cells = Record<AppRole, AccessLevel>;

/** Every role at `rest`, then the named roles at their own level. */
function row(rest: AccessLevel, named: Partial<Cells> = {}): Cells {
  return {
    admin: rest,
    estates_head: rest,
    project_engineer: rest,
    technician: rest,
    finance: rest,
    clinical_approver: rest,
    executive_readonly: rest,
    auditor_readonly: rest,
    ...named,
  };
}

// The three roles that run a project's works (ADR-0015's `can_manage_project`).
const RUNS_WORKS = { admin: "WRITE", estates_head: "WRITE", project_engineer: "WRITE" } as const;

export const ROLE_MATRIX: Record<MatrixArea, Cells> = {
  // Everyone reads the portfolio of the units they see; nobody writes it.
  portfolio: row("READ"),

  // RULE (ADR-0015, `can_manage_project`): the register is the three works
  // roles' to write. The administrator alone moves a phase backwards (R04).
  // RULE (ADR-0014): from APPROVED on, only finance changes the approved
  // budget, and the administrator is not exempt.
  projectRecords: row("READ", RUNS_WORKS),
  projectPhase: row("READ", { ...RUNS_WORKS, admin: "MANAGE" }),
  approvedBudget: row("READ", { finance: "APPROVE" }),

  contractRecords: row("READ", RUNS_WORKS),
  rfisInstructions: row("READ", RUNS_WORKS),
  variationSubmit: row("READ", RUNS_WORKS),
  // RULE (ADR-0015, R10): the head of estates or the administrator decides.
  variationDecide: row("READ", { admin: "APPROVE", estates_head: "APPROVE" }),
  // RULE (`can_manage_defect`): a technician raises one found on inspection
  // or on a work order, never a handover defect.
  defects: row("READ", { ...RUNS_WORKS, technician: "WRITE" }),
  paymentCertCreate: row("READ", RUNS_WORKS),
  paymentCertEngineer: row("READ", { admin: "APPROVE", estates_head: "APPROVE", project_engineer: "APPROVE" }),
  paymentCertFinance: row("READ", { admin: "APPROVE", finance: "APPROVE" }),

  // The two screens under «Κόστος» in the nav are the SAP import and the
  // accruals; the budget lines and the forecast inputs live on the project's
  // own «Κόστος» tab, which every reader of the project sees.
  sapImport: row("NONE", { admin: "WRITE", finance: "WRITE" }),
  budgetLines: row("READ", { admin: "WRITE", finance: "WRITE" }),
  accruals: row("NONE", {
    admin: "READ",
    estates_head: "READ",
    finance: "READ",
    executive_readonly: "READ",
    auditor_readonly: "READ",
  }),
  forecastWarnings: row("READ", RUNS_WORKS),

  // The head of estates and the administrator may also reject a request
  // (CAPEX-01 §10's segregation): that is the APPROVE on this row.
  permitRequest: row("READ", { admin: "APPROVE", estates_head: "APPROVE", project_engineer: "WRITE" }),
  // Only the approver a line is assigned to decides it (CAPEX-01 §9).
  permitClinical: row("READ", { clinical_approver: "APPROVE" }),
  permitOperate: row("READ", RUNS_WORKS),
  permitCalendar: row("READ"),

  assetRegister: row("READ", RUNS_WORKS),
  assetCondition: row("READ", { ...RUNS_WORKS, technician: "WRITE" }),
  assetDocuments: row("READ", RUNS_WORKS),
  assetForecast: row("NONE", {
    admin: "READ",
    estates_head: "READ",
    finance: "READ",
    executive_readonly: "READ",
  }),
  // Anyone who sees an asset may print its QR label.
  assetLabels: row("READ"),

  // RULE (ADR-0031 §10, owner answer 06/10/2026): the clinical approver may
  // raise a call too, and does nothing more with it.
  workOrderRaise: row("READ", { ...RUNS_WORKS, technician: "WRITE", clinical_approver: "WRITE" }),
  workOrderWork: row("READ", { ...RUNS_WORKS, technician: "WRITE" }),
  maintenanceAgreement: row("READ", { admin: "MANAGE", estates_head: "MANAGE" }),
  backlog: row("READ", RUNS_WORKS),
  backlogToProject: row("READ", { admin: "APPROVE", estates_head: "APPROVE" }),
  scorecard: row("READ"),

  // RULE (ADR-0032 §6).
  reports: row("NONE", {
    admin: "READ",
    estates_head: "READ",
    finance: "READ",
    executive_readonly: "READ",
    auditor_readonly: "READ",
  }),

  users: row("NONE", { admin: "MANAGE" }),
  // RULE (ADR-0015): admin and the head of estates keep the register; an
  // engineer picks from it when writing a contract.
  contractors: row("NONE", { admin: "MANAGE", estates_head: "MANAGE", project_engineer: "READ" }),
  efinance: row("NONE", { admin: "MANAGE" }),

  // The whole log (`GET /audit-log`). Each record's own history is shown to
  // whoever reads the record.
  auditTrail: row("NONE", { admin: "READ", auditor_readonly: "READ" }),
};

/** The «Μονάδες» row: own units or all of them, straight from the role catalogue. */
export const MATRIX_UNITS: Record<AppRole, RoleScope> = ROLE_SCOPE;

/** Notes shown under the table. Text in i18n under `screens.s24roles.notes`. */
export const RoleNoteKey = z.enum([
  "noSelfApproval",
  "readOnlyWins",
  "databaseDecides",
  "estatesDecides",
  "estatesMaintenance",
  "engineerSubmits",
  "engineerPicksContractor",
  "technicianReads",
  "technicianField",
  "technicianDefects",
  "financeAllUnits",
  "financeBudget",
  "financeNoRegister",
  "clinicalAreas",
  "clinicalLine",
  "clinicalCalls",
  "executiveReads",
  "auditorTrail",
  "auditorServer",
  "adminPhaseBack",
  "adminBudget",
  "adminApprovers",
  "adminAuditor",
]);
export type RoleNoteKey = z.infer<typeof RoleNoteKey>;

/** Notes that hold for every role. */
export const GENERAL_NOTES: readonly RoleNoteKey[] = ["noSelfApproval", "readOnlyWins", "databaseDecides"];

export const ROLE_NOTES: Record<AppRole, readonly RoleNoteKey[]> = {
  estates_head: ["estatesDecides", "estatesMaintenance"],
  project_engineer: ["engineerSubmits", "engineerPicksContractor"],
  technician: ["technicianReads", "technicianField", "technicianDefects"],
  finance: ["financeAllUnits", "financeBudget", "financeNoRegister"],
  clinical_approver: ["clinicalAreas", "clinicalLine", "clinicalCalls"],
  executive_readonly: ["executiveReads"],
  auditor_readonly: ["auditorTrail", "auditorServer"],
  admin: ["adminPhaseBack", "adminBudget", "adminApprovers", "adminAuditor"],
};

/** One role's level on one row. */
export function accessOf(area: MatrixArea, role: AppRole): AccessLevel {
  return ROLE_MATRIX[area][role];
}
