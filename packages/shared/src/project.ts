import { z } from "zod";

// CAPEX-01 §4: project category. The migration mapping (CAPEX-03 col A)
// only ever produces CAPITAL_WORKS for the imported rows, but the target
// data model carries the full set so the system can classify new projects
// created after go-live.
export const ProjectCategory = z.enum([
  "NEW_BUILD",
  "RENOVATION",
  "SMALL_WORKS",
  "EQUIPMENT",
  "MAINTENANCE_CAPITAL",
  "IT",
]);
export type ProjectCategory = z.infer<typeof ProjectCategory>;

// Reconciliation note (CAPEX-01 §4 vs CAPEX-03 §4): CAPEX-01 lists eight
// phases (IDEA…CLOSED). CAPEX-03 §4 maps the three source statuses onto
// what it calls "the target model['s] nine" phases, without listing a
// ninth. PREPARATION is the missing one: CAPEX-03 §4 says "Preparation
// covers everything from idea to signed contract", which is exactly the
// gap between IDEA and APPROVED in the CAPEX-01 list, and is the phase
// that holds 70 of the 113 migrated rows. Inserted here between IDEA and
// APPROVED to reconcile the two documents. Flagged in the build summary
// rather than guessed silently.
export const ProjectPhase = z.enum([
  "IDEA",
  "PREPARATION",
  "APPROVED",
  "TENDERED",
  "AWARDED",
  "IN_PROGRESS",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
]);
export type ProjectPhase = z.infer<typeof ProjectPhase>;

export const FundingSource = z.enum(["STATE_BUDGET", "EU", "DONATION", "OWN"]);
export type FundingSource = z.infer<typeof FundingSource>;

// CAPEX-01 §7: red/amber/green health of a project, set from the four
// ledgers below. GREEN|AMBER|RED per the UI instructions §1 token set.
export const Rag = z.enum(["GREEN", "AMBER", "RED"]);
export type Rag = z.infer<typeof Rag>;

// CAPEX-01 §4 `project` (the subset the portfolio and cost screens need;
// business case, milestones, risks and issues are separate tables not
// built here).
export const Project = z.object({
  id: z.string(),
  code: z.string(),
  orgUnitId: z.string(),
  titleEl: z.string(),
  // The system never machine-translates content (CAPEX-01 §6.1); an English
  // title exists only when someone typed one.
  titleEn: z.string().nullable().default(null),
  // CAPEX-03 col E: the trailing parenthetical note split off the title.
  noteEl: z.string().nullable().default(null),
  category: ProjectCategory,
  phase: ProjectPhase,
  approvedBudget: z.number().nonnegative(),
  fundingSource: FundingSource,
  // CAPEX-03 §2: a date cell can be missing or hold text (V06), so the
  // planned dates are nullable and the importer flags the row instead of
  // inventing a date.
  plannedStart: z.string().nullable(), // ISO date, e.g. 2026-09-01
  plannedFinish: z.string().nullable(),
  forecastStart: z.string().nullable().default(null), // CAPEX-03 col AB
  forecastFinish: z.string().nullable().default(null), // CAPEX-03 col AC
  actualStart: z.string().nullable().default(null),
  actualFinish: z.string().nullable().default(null),
  budgetYearFrom: z.number().int().nullable().default(null),
  budgetYearTo: z.number().int().nullable().default(null),
  rag: Rag,
  ragReason: z.string(),
  sapWbs: z.string().nullable(),
  tenderReference: z.string().nullable(),
  // CAPEX-03 cols F, H, I, J, K, AE — carried so the register can be
  // reconciled to the sheet it came from during the first year (CAPEX-01 §9).
  budgetArticle: z.string().nullable().default(null), // 08021 | 08022 | 08023
  commitmentFlag: z.boolean().default(false),
  commitmentNote: z.string().nullable().default(null),
  actionPlanRef: z.string().nullable().default(null),
  inBudget2026: z.boolean().default(false),
  contractualCommitment: z.boolean().default(false),
  internalAuditFile: z.boolean().default(false),
  sourceRowRef: z.string().nullable().default(null), // CAPEX-03 col B, reference only
  sponsorId: z.string().nullable().default(null),
  projectManagerId: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null), // ISO timestamp, UTC
  updatedAt: z.string().nullable().default(null),
});
export type Project = z.infer<typeof Project>;

// CAPEX-01 §7: the four ledgers, always kept separate — never collapsed
// into one "spend" number. Figures in EUR.
export const ProjectLedgers = z.object({
  approved: z.number(),
  // RULE (CAPEX-01 §7): a ledger the system does not know yet is null, never
  // zero. Committed = the sum of contract currentValue (original + approved
  // variations) once the project has a contract, null before; spent arrives
  // with the SAP ingestion (M2, R14) and the forecast is derived from them
  // (R16); until then screens show «—».
  committed: z.number().nullable(),
  spent: z.number().nullable(),
  forecast: z.number().nullable(),
});
export type ProjectLedgers = z.infer<typeof ProjectLedgers>;

export const ProjectSummary = Project.extend({
  ledgers: ProjectLedgers,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

// ------------------------------------------------------------ M1 (R04–R07)

// CAPEX-01 §4 `milestone`. Baseline never moves; forecast and actual do.
export const Milestone = z.object({
  id: z.string(),
  projectId: z.string(),
  titleEl: z.string(),
  baselineDate: z.string(), // ISO date
  forecastDate: z.string().nullable(),
  actualDate: z.string().nullable(),
  // RULE (R04): a gate milestone closes a phase; the phase cannot advance
  // past it until the gate has an actual date.
  isGate: z.boolean(),
  sortOrder: z.number().int(),
});
export type Milestone = z.infer<typeof Milestone>;

export const RiskStatus = z.enum(["OPEN", "MITIGATED", "CLOSED"]);
export type RiskStatus = z.infer<typeof RiskStatus>;

// CAPEX-01 §4 `risk`. Likelihood × impact on a 1–5 scale gives the score.
export const Risk = z.object({
  id: z.string(),
  projectId: z.string(),
  descriptionEl: z.string(),
  likelihood: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  ownerId: z.string().nullable(),
  ownerName: z.string().nullable(),
  mitigationEl: z.string().nullable(),
  status: RiskStatus,
});
export type Risk = z.infer<typeof Risk>;

export const IssueStatus = z.enum(["OPEN", "RESOLVED"]);
export type IssueStatus = z.infer<typeof IssueStatus>;

// CAPEX-01 §4 `issue`.
export const Issue = z.object({
  id: z.string(),
  projectId: z.string(),
  descriptionEl: z.string(),
  raisedById: z.string(),
  raisedByName: z.string(),
  dueDate: z.string().nullable(),
  status: IssueStatus,
});
export type Issue = z.infer<typeof Issue>;

// One line of the audit trail as the Timeline component shows it: actor,
// verb, when, and an optional one-line diff. Built from audit_log (R42).
export const AuditEntry = z.object({
  id: z.string(),
  actorName: z.string(),
  action: z.string(), // i18n key suffix, e.g. "created", "phaseChanged"
  at: z.string(), // ISO timestamp, UTC
  detail: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

// S03 project overview: everything the screen needs in one call.
export const ProjectDetail = ProjectSummary.extend({
  orgUnit: z.object({ id: z.string(), nameEl: z.string(), nameEn: z.string() }),
  sponsorName: z.string().nullable(),
  projectManagerName: z.string().nullable(),
  milestones: z.array(Milestone),
  risks: z.array(Risk),
  issues: z.array(Issue),
  audit: z.array(AuditEntry),
});
export type ProjectDetail = z.infer<typeof ProjectDetail>;

// S02 project list. Filters map one-to-one to FilterBar chips and to the
// URL query (UI instructions §4 FilterBar).
export const ProjectSort = z.enum([
  "titleEl",
  "code",
  "orgUnit",
  "phase",
  "approvedBudget",
  "plannedFinish",
  "rag",
  "updatedAt",
]);
export type ProjectSort = z.infer<typeof ProjectSort>;

export const ProjectListQuery = z.object({
  unit: z.array(z.string()).default([]),
  phase: z.array(ProjectPhase).default([]),
  category: z.array(ProjectCategory).default([]),
  rag: z.array(Rag).default([]),
  q: z.string().default(""), // matches code and titleEl, case- and accent-insensitive
  sort: ProjectSort.default("approvedBudget"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuery>;

export const ProjectList = z.object({
  items: z.array(ProjectSummary),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProjectList = z.infer<typeof ProjectList>;

// Writes. Every mutation is audited (R42) and row-scoped by org unit (R01).
export const ProjectCreate = Project.pick({
  orgUnitId: true,
  titleEl: true,
  titleEn: true,
  category: true,
  approvedBudget: true,
  fundingSource: true,
  plannedStart: true,
  plannedFinish: true,
  budgetYearFrom: true,
  budgetYearTo: true,
  sapWbs: true,
  tenderReference: true,
  sponsorId: true,
  projectManagerId: true,
}).extend({
  // Code is allocated by the API (unit code + year + sequence), never typed.
  code: z.undefined().optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreate>;

export const ProjectUpdate = ProjectCreate.omit({ orgUnitId: true, code: true }).partial();
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

// RULE (R04): phases only move forward, one step at a time, with a reason;
// going back is a new decision that admin records, not an edit.
export const ProjectPhaseChange = z.object({
  phase: ProjectPhase,
  reasonEl: z.string().min(1),
});
export type ProjectPhaseChange = z.infer<typeof ProjectPhaseChange>;

export const MilestoneWrite = Milestone.omit({ id: true, projectId: true }).partial({
  forecastDate: true,
  actualDate: true,
  sortOrder: true,
});
export type MilestoneWrite = z.infer<typeof MilestoneWrite>;

export const RiskWrite = Risk.omit({ id: true, projectId: true, ownerName: true }).partial({
  ownerId: true,
  mitigationEl: true,
  status: true,
});
export type RiskWrite = z.infer<typeof RiskWrite>;

export const IssueWrite = Issue.omit({ id: true, projectId: true, raisedById: true, raisedByName: true }).partial({
  dueDate: true,
  status: true,
});
export type IssueWrite = z.infer<typeof IssueWrite>;
