/**
 * Turning project rows into the shapes packages/shared publishes, and the
 * two rules that are pure functions of a row: the phase order (R04) and the
 * audit line a change produces (R42).
 *
 * Kept out of the service so the rules can be unit-tested without a database
 * and so the service reads as "fetch, apply rule, write".
 */
import { type AuditEntry, ProjectPhase, type ProjectSummary } from "@ecapital/shared";

/**
 * RULE (R04): the nine phases in order. A project moves exactly one step
 * along this list. The enum in packages/shared is the single list; repeating
 * it here would be a second place to get it wrong.
 */
export const PHASE_ORDER: readonly ProjectPhase[] = ProjectPhase.options;

export function phaseIndex(phase: ProjectPhase): number {
  return PHASE_ORDER.indexOf(phase);
}

/** RULE (R04): forward, one step, no skipping. Backwards is not a step. */
export function isNextPhase(from: ProjectPhase, to: ProjectPhase): boolean {
  return phaseIndex(to) - phaseIndex(from) === 1;
}

/** numeric(14,2) arrives as a string so no precision is lost in transit. */
export function money(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export interface ProjectRow {
  id: string;
  code: string;
  orgUnitId: string;
  titleEl: string;
  titleEn: string | null;
  noteEl: string | null;
  category: ProjectSummary["category"];
  phase: ProjectPhase;
  approvedBudget: string | number;
  fundingSource: ProjectSummary["fundingSource"];
  plannedStart: string | null;
  plannedFinish: string | null;
  forecastStart: string | null;
  forecastFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  budgetYearFrom: number | null;
  budgetYearTo: number | null;
  rag: ProjectSummary["rag"];
  ragReason: string;
  sapWbs: string | null;
  tenderReference: string | null;
  budgetArticle: string | null;
  commitmentFlag: boolean;
  commitmentNote: string | null;
  actionPlanRef: string | null;
  inBudget2026: boolean;
  contractualCommitment: boolean;
  internalAuditFile: boolean;
  sourceRowRef: string | null;
  sponsorId: string | null;
  projectManagerId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  /**
   * The sum of the current value of the project's contracts, as the database
   * adds it up: null when the project has no contract at all, because a sum
   * over no rows is not zero (CAPEX-01 §7).
   */
  committed?: string | number | null;
}

/**
 * RULE (CAPEX-01 §7): the four ledgers are never collapsed, and a ledger the
 * system does not know yet is null, not zero.
 *
 * M1 knows two of them. The approved budget is known from the day a project
 * is opened. The commitment is the sum of the current value of the project's
 * contracts — the contract value plus its approved variations (R13, R08) —
 * and is null, not zero, while the project has no contract: a project that
 * has not been awarded has not committed nothing, it has committed nothing
 * *yet*, and the screens show «—» for the difference. Spent and forecast
 * arrive with the SAP ingestion in M2 (R14, R16).
 */
export function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    code: row.code,
    orgUnitId: row.orgUnitId,
    titleEl: row.titleEl,
    titleEn: row.titleEn,
    noteEl: row.noteEl,
    category: row.category,
    phase: row.phase,
    approvedBudget: money(row.approvedBudget),
    fundingSource: row.fundingSource,
    plannedStart: row.plannedStart,
    plannedFinish: row.plannedFinish,
    forecastStart: row.forecastStart,
    forecastFinish: row.forecastFinish,
    actualStart: row.actualStart,
    actualFinish: row.actualFinish,
    budgetYearFrom: row.budgetYearFrom,
    budgetYearTo: row.budgetYearTo,
    rag: row.rag,
    ragReason: row.ragReason,
    sapWbs: row.sapWbs,
    tenderReference: row.tenderReference,
    budgetArticle: row.budgetArticle,
    commitmentFlag: row.commitmentFlag,
    commitmentNote: row.commitmentNote,
    actionPlanRef: row.actionPlanRef,
    inBudget2026: row.inBudget2026,
    contractualCommitment: row.contractualCommitment,
    internalAuditFile: row.internalAuditFile,
    sourceRowRef: row.sourceRowRef,
    sponsorId: row.sponsorId,
    projectManagerId: row.projectManagerId,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
    ledgers: {
      approved: money(row.approvedBudget),
      committed:
        row.committed === undefined || row.committed === null ? null : money(row.committed),
      spent: null,
      forecast: null,
    },
  };
}

// ------------------------------------------------------------ audit line --

/** Database column → the name the contract and the screens use for it. */
const FIELD_NAMES: Record<string, string> = {
  title_el: "titleEl",
  title_en: "titleEn",
  note_el: "noteEl",
  category: "category",
  approved_budget: "approvedBudget",
  funding_source: "fundingSource",
  planned_start: "plannedStart",
  planned_finish: "plannedFinish",
  forecast_start: "forecastStart",
  forecast_finish: "forecastFinish",
  actual_start: "actualStart",
  actual_finish: "actualFinish",
  budget_year_from: "budgetYearFrom",
  budget_year_to: "budgetYearTo",
  rag: "rag",
  rag_reason: "ragReason",
  sap_wbs: "sapWbs",
  tender_reference: "tenderReference",
  budget_article: "budgetArticle",
  commitment_flag: "commitmentFlag",
  commitment_note: "commitmentNote",
  action_plan_ref: "actionPlanRef",
  in_budget_2026: "inBudget2026",
  contractual_commitment: "contractualCommitment",
  internal_audit_file: "internalAuditFile",
  sponsor_id: "sponsorId",
  project_manager_id: "projectManagerId",
  baseline_date: "baselineDate",
  forecast_date: "forecastDate",
  actual_date: "actualDate",
  is_gate: "isGate",
  sort_order: "sortOrder",
  description_el: "descriptionEl",
  likelihood: "likelihood",
  impact: "impact",
  owner_id: "ownerId",
  mitigation_el: "mitigationEl",
  status: "status",
  due_date: "dueDate",
  phase: "phase",
};

/** Bookkeeping the reader does not need to see on a timeline. */
const NOISE = new Set(["updated_at", "created_at", "search_norm", "phase_changed_at", "id"]);

export interface AuditRow {
  id: number;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: Date;
}

const ADDED: Record<string, string> = {
  milestone: "milestoneAdded",
  risk: "riskAdded",
  issue: "issueAdded",
};
const UPDATED: Record<string, string> = {
  milestone: "milestoneUpdated",
  risk: "riskUpdated",
  issue: "issueUpdated",
};

function changedColumns(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (!before || !after) return [];
  return Object.keys(after)
    .filter((key) => !NOISE.has(key))
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => FIELD_NAMES[key] ?? key);
}

/**
 * One audit row as one timeline line (R42). `action` is an i18n key suffix,
 * so the sentence is written in the screen's language and not here; `detail`
 * is the short line underneath it — the phase move with the reason that was
 * given for it, or the names of the fields that changed.
 */
export function toAuditEntry(row: AuditRow): AuditEntry {
  const before = row.before;
  const after = row.after;

  let action: string;
  let detail: string | null = null;

  if (row.entityType === "project") {
    if (row.action === "INSERT") {
      action = "created";
      detail = typeof after?.code === "string" ? after.code : null;
    } else if (
      row.action === "UPDATE" &&
      before?.phase !== after?.phase &&
      typeof after?.phase === "string"
    ) {
      action = "phaseChanged";
      const reason = typeof after.phase_reason_el === "string" ? after.phase_reason_el : "";
      detail = `${String(before?.phase ?? "")} → ${after.phase}${reason ? `: ${reason}` : ""}`;
    } else {
      action = "updated";
      const fields = changedColumns(before, after);
      detail = fields.length ? fields.join(", ") : null;
    }
  } else if (row.action === "INSERT") {
    action = ADDED[row.entityType] ?? "created";
    detail = typeof after?.title_el === "string" ? after.title_el : titleOf(after);
  } else {
    action = UPDATED[row.entityType] ?? "updated";
    const fields = changedColumns(before, after);
    detail = fields.length ? fields.join(", ") : null;
  }

  return {
    id: String(row.id),
    // `seed` and any other non-user actor shows as itself rather than blank.
    actorName: row.actorName ?? row.actorId ?? "",
    action,
    at: row.at.toISOString(),
    detail,
  };
}

/** A risk and an issue have no title; the first words of the text will do. */
function titleOf(after: Record<string, unknown> | null): string | null {
  const text = after?.description_el;
  if (typeof text !== "string") return null;
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
