import { z } from "zod";
import { AccessLevel, ACCESS_RANK, MatrixArea } from "./access";
import { AppRole } from "./auth";
import { ROLE_SCOPE, type RoleScope } from "./roles";

export { AccessLevel, ACCESS_RANK, MatrixArea, atLeast } from "./access";

/**
 * S24r «Ρόλοι και δικαιώματα» — what each of the eight roles sees and does.
 *
 * ADR-0033: the matrix is the rule, not a description of it. It is stored in
 * `ecapital.role_permission`, the administrator edits it on the roles tab,
 * and all three enforcement points read it: the row policies through
 * `ecapital.allowed(area, level)`, the API's `@Needs(area, level)` guard
 * through `PermissionsService`, and the web helpers in
 * `apps/web/src/auth/roles.ts` through the matrix the session loads.
 * `ROLE_MATRIX` below is the default: what migration 0023 seeds, what
 * «Επαναφορά προεπιλογών» puts back, and what the web uses until the API has
 * answered. `apps/web/src/auth/role-matrix.test.ts` checks every helper
 * against whatever matrix is loaded.
 *
 * The five levels, lowest first:
 *
 *   NONE     the area is not shown to the role at all
 *   READ     sees it, changes nothing
 *   WRITE    creates and edits records
 *   APPROVE  decides: approves, rejects, pays, funds
 *   MANAGE   full control, including the settings the area runs on
 *
 * A higher level includes the lower ones for the same row. The levels and the
 * rows themselves (`AccessLevel`, `MatrixArea`) live in `./access.ts`, so that
 * `Me` in `./auth.ts` can carry them without the two files importing each other.
 */

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

/** One role's level on one row of the default matrix. */
export function accessOf(area: MatrixArea, role: AppRole): AccessLevel {
  return ROLE_MATRIX[area][role];
}

// ------------------------------------------------------------ ADR-0033

/** The name the API and ADR-0033 use for a row of the matrix. */
export const AreaKey = MatrixArea;
export type AreaKey = MatrixArea;

/** The whole matrix: area, then role, then level. */
export type RoleMatrix = Record<MatrixArea, Record<AppRole, AccessLevel>>;

/** One role's column: a level for every area. */
export type RoleColumn = Record<MatrixArea, AccessLevel>;

/**
 * The things the administrator cannot change (ADR-0033). Each is enforced
 * by the BEFORE trigger on `ecapital.role_permission`, refused by the API
 * with 422 `errors.rolePermissionGuardrail`, and shown on the roles tab as a
 * locked cell. Text under `screens.s24roles.guardrails`.
 *
 *   readOnlyRoles   the auditor and the executive never above READ
 *                   (ADR-0010: they write nothing, and `can_write_unit` says
 *                   so underneath whatever the matrix holds)
 *   adminUsers      the administrator keeps MANAGE on users, so nobody can
 *                   lock the way back in
 *   adminReads      the administrator keeps at least READ everywhere
 *   auditTrailRead  the audit trail is read, never written (ADR-0011)
 *   usersAdminOnly  the user and role screens answer to the administrator's
 *                   identity, not to the matrix (a role that could hand out
 *                   roles could hand itself `admin`), so the row stays NONE
 *                   for every other role rather than promise what it cannot do
 */
export const GuardrailKey = z.enum(["readOnlyRoles", "adminUsers", "adminReads", "auditTrailRead", "usersAdminOnly"]);
export type GuardrailKey = z.infer<typeof GuardrailKey>;

export const GUARDRAILS: readonly GuardrailKey[] = GuardrailKey.options;

export interface LevelBounds {
  min: AccessLevel;
  max: AccessLevel;
  /** The guardrails that narrow this cell, empty when it is free. */
  guardrails: GuardrailKey[];
}

const LEVELS_LOW_FIRST: readonly AccessLevel[] = AccessLevel.options;

/**
 * The range a cell may take. RULE (ADR-0033): this function, the SQL trigger
 * `ecapital.role_permission_guard` and the API's 422 say the same thing; the
 * API's permissions test pins the trigger against this function cell by cell.
 */
export function levelBounds(role: AppRole, area: MatrixArea): LevelBounds {
  let min = 0;
  let max = 4;
  const guardrails: GuardrailKey[] = [];
  if (role === "auditor_readonly" || role === "executive_readonly") {
    max = Math.min(max, 1);
    guardrails.push("readOnlyRoles");
  }
  if (area === "auditTrail") {
    max = Math.min(max, 1);
    guardrails.push("auditTrailRead");
  }
  if (role === "admin") {
    min = Math.max(min, 1);
    guardrails.push("adminReads");
  }
  if (role === "admin" && area === "users") {
    min = 4;
    guardrails.push("adminUsers");
  }
  if (role !== "admin" && area === "users") {
    max = 0;
    guardrails.push("usersAdminOnly");
  }
  return { min: LEVELS_LOW_FIRST[min], max: LEVELS_LOW_FIRST[max], guardrails };
}

/** True when the level is inside the cell's bounds. */
export function withinBounds(role: AppRole, area: MatrixArea, level: AccessLevel): boolean {
  const { min, max } = levelBounds(role, area);
  return ACCESS_RANK[level] >= ACCESS_RANK[min] && ACCESS_RANK[level] <= ACCESS_RANK[max];
}

/** The levels a cell may take, lowest first — what the editor offers. */
export function allowedLevels(role: AppRole, area: MatrixArea): AccessLevel[] {
  return LEVELS_LOW_FIRST.filter((level) => withinBounds(role, area, level));
}

/** The highest level any of `roles` holds on `area`; no role at all is NONE. */
export function levelFor(matrix: RoleMatrix, roles: readonly AppRole[], area: MatrixArea): AccessLevel {
  let best: AccessLevel = "NONE";
  for (const role of roles) {
    const level = matrix[area]?.[role] ?? "NONE";
    if (ACCESS_RANK[level] > ACCESS_RANK[best]) best = level;
  }
  return best;
}

/** Every area at the highest level any of `roles` holds — what `/me` carries. */
export function effectiveFor(matrix: RoleMatrix, roles: readonly AppRole[]): RoleColumn {
  return Object.fromEntries(MatrixArea.options.map((area) => [area, levelFor(matrix, roles, area)])) as RoleColumn;
}

/** A deep copy of the defaults, safe to change. */
export function defaultRoleMatrix(): RoleMatrix {
  return Object.fromEntries(MatrixArea.options.map((area) => [area, { ...ROLE_MATRIX[area] }])) as RoleMatrix;
}

/** One role's column out of a matrix. */
export function columnOf(matrix: RoleMatrix, role: AppRole): RoleColumn {
  return Object.fromEntries(MatrixArea.options.map((area) => [area, matrix[area][role]])) as RoleColumn;
}

/** A level for every area; zod's record over an enum demands every key. */
export const RoleColumnSchema = z.record(MatrixArea, AccessLevel);

/** The whole matrix as the API sends it. */
export const RoleMatrixSchema = z.record(MatrixArea, z.record(AppRole, AccessLevel));

/** What `GET /admin/roles/permissions` answers. Any signed-in user may read it. */
export const RolePermissionsResponse = z.object({
  matrix: RoleMatrixSchema,
  guardrails: z.array(GuardrailKey),
  /** The last change, or null while every row is still the seeded default. */
  updatedAt: z.string().nullable(),
});
export type RolePermissionsResponse = z.infer<typeof RolePermissionsResponse>;

/** What `PUT /admin/roles/:role` takes: the whole column for that role. */
export const RolePermissionsWrite = RoleColumnSchema;
export type RolePermissionsWrite = z.infer<typeof RolePermissionsWrite>;
