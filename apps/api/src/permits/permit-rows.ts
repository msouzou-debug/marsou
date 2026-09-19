/**
 * Turning permit rows into the shapes `packages/shared/src/permit.ts`
 * publishes, and the two derived facts a list needs.
 *
 * Kept out of the service for the same reason `rfi-rows.ts` is: the SLA band
 * and the «is this permit live» arithmetic are rules, and a rule that needs a
 * database to test is a rule nobody tests.
 */
import type {
  AffectedArea,
  AuditEntry,
  CloseoutChecklist,
  IcraResult,
  IlsmCheck,
  PermitApproval,
  PermitListRow,
  PermitStatus,
  PatientRiskGroup,
  ShutdownPermit,
  SurroundingArea,
} from "@ecapital/shared";
import { RISK_ORDER } from "../icra/icra-engine";
import { approvalSlaState } from "./permit-sla";

export interface PermitRow {
  id: string;
  ref: string | null;
  orgUnitId: string;
  projectId: string | null;
  contractId: string | null;
  titleEl: string;
  descriptionEl: string;
  workKind: ShutdownPermit["workKind"];
  systems: ShutdownPermit["systems"];
  plannedStart: Date;
  plannedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  icra: IcraResult | null;
  surrounding: SurroundingArea[];
  ilsm: IlsmCheck | null;
  contingencyPlanEl: string | null;
  status: PermitStatus;
  /** True while the window is the placeholder the API invented (0016). */
  windowProvisional: boolean;
  closeout: CloseoutChecklist | null;
  clashes: ShutdownPermit["clashes"];
  requestedById: string;
  requestedByName: string | null;
  requestedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  closedById: string | null;
  closedAt: Date | null;
  breachedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApprovalRow {
  id: string;
  permitId: string;
  role: PermitApproval["role"];
  reason: PermitApproval["reason"];
  areaId: string | null;
  areaNameEl: string | null;
  approverId: string | null;
  approverName: string | null;
  decision: PermitApproval["decision"];
  commentEl: string | null;
  decidedAt: Date | null;
  dueAt: Date;
  slaHours: number;
}

export function toApproval(row: ApprovalRow, now: Date): PermitApproval {
  return {
    id: row.id,
    permitId: row.permitId,
    role: row.role,
    reason: row.reason,
    areaId: row.areaId,
    areaNameEl: row.areaNameEl,
    approverId: row.approverId,
    approverName: row.approverName,
    decision: row.decision,
    commentEl: row.commentEl,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    dueAt: row.dueAt.toISOString(),
    // Computed on the way out and never stored, like the RFI's (ADR-0017).
    slaState: approvalSlaState(row.dueAt, row.slaHours, row.decidedAt, now),
  };
}

export function toPermit(
  row: PermitRow,
  areas: AffectedArea[],
  approvals: PermitApproval[],
): ShutdownPermit {
  return {
    id: row.id,
    ref: row.ref,
    orgUnitId: row.orgUnitId,
    projectId: row.projectId,
    contractId: row.contractId,
    titleEl: row.titleEl,
    descriptionEl: row.descriptionEl,
    workKind: row.workKind,
    systems: row.systems,
    affectedAreas: areas,
    plannedStart: row.plannedStart.toISOString(),
    plannedEnd: row.plannedEnd.toISOString(),
    actualStart: row.actualStart ? row.actualStart.toISOString() : null,
    actualEnd: row.actualEnd ? row.actualEnd.toISOString() : null,
    icra: row.icra,
    surrounding: row.surrounding,
    ilsm: row.ilsm,
    contingencyPlanEl: row.contingencyPlanEl,
    status: row.status,
    approvals,
    closeout: row.closeout,
    requestedById: row.requestedById,
    requestedByName: row.requestedByName ?? "",
    requestedAt: row.requestedAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    closedById: row.closedById,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    breachedAt: row.breachedAt ? row.breachedAt.toISOString() : null,
    clashes: row.clashes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface PermitListRowInput {
  id: string;
  ref: string | null;
  orgUnitId: string;
  orgUnitNameEl: string;
  projectId: string | null;
  titleEl: string;
  systems: ShutdownPermit["systems"];
  plannedStart: Date;
  plannedEnd: Date;
  status: PermitStatus;
  breachedAt: Date | null;
  icraClass: PermitListRow["icraClass"];
  areaCount: number;
  riskGroups: (PatientRiskGroup | null)[];
  pendingApprovals: number;
}

export function toListRow(row: PermitListRowInput): PermitListRow {
  return {
    id: row.id,
    ref: row.ref,
    orgUnitId: row.orgUnitId,
    orgUnitNameEl: row.orgUnitNameEl,
    projectId: row.projectId,
    titleEl: row.titleEl,
    systems: row.systems,
    plannedStart: row.plannedStart.toISOString(),
    plannedEnd: row.plannedEnd.toISOString(),
    status: row.status,
    breachedAt: row.breachedAt ? row.breachedAt.toISOString() : null,
    icraClass: row.icraClass,
    areaCount: row.areaCount,
    highestRiskGroup: highestOf(row.riskGroups),
    pendingApprovals: row.pendingApprovals,
  };
}

/** The worst band among the permit's areas, for the list column. */
export function highestOf(groups: (PatientRiskGroup | null)[]): PatientRiskGroup | null {
  let best: PatientRiskGroup | null = null;
  for (const group of groups) {
    if (!group) continue;
    if (best === null || RISK_ORDER.indexOf(group) > RISK_ORDER.indexOf(best)) best = group;
  }
  return best;
}

/**
 * RULE (§6.5): «Permit is live only inside its window.» The window is
 * inclusive at both ends — a permit whose window starts at 08:00 can be
 * started at 08:00, and one that ends at 18:00 can still be started at 18:00,
 * because a clock that refuses on the boundary sends somebody to look for a
 * manager instead of into the plant room.
 */
export function insideWindow(now: Date, start: Date, end: Date): boolean {
  return now.getTime() >= start.getTime() && now.getTime() <= end.getTime();
}

/** RULE (§6.5): an overrun is an ACTIVE permit whose end has gone past. */
export function hasOverrun(now: Date, end: Date): boolean {
  return now.getTime() > end.getTime();
}

/** RULE (§6.6): every box true. `noteEl` is a note, not a box. */
export function checklistComplete(checklist: CloseoutChecklist): boolean {
  return (
    checklist.barriersRemoved &&
    checklist.areaCleaned &&
    checklist.airBalanceRestored &&
    checklist.systemsTestedAndReturned &&
    checklist.fireSystemsReenabled
  );
}

/** §6.6 and R24: a permit in one of these states blocks a project milestone. */
export const OPEN_PERMIT_STATUSES: PermitStatus[] = [
  "SUBMITTED",
  "CLINICAL_REVIEW",
  "APPROVED",
  "ACTIVE",
  "BREACH",
];

/** R25: what the disruption calendar draws. */
export const CALENDAR_STATUSES: PermitStatus[] = [
  "CLINICAL_REVIEW",
  "APPROVED",
  "ACTIVE",
  "BREACH",
];

/** §6.7: a permit that is neither closed nor rejected can still clash. */
export const LIVE_PERMIT_STATUSES: PermitStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "CLINICAL_REVIEW",
  "APPROVED",
  "ACTIVE",
  "BREACH",
];

// ----------------------------------------------------------- R42, S13 --

/** The last lines a permit page shows, matching the project page's limit. */
export const AUDIT_LINES = 50;

export interface PermitAuditRow {
  id: number;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: Date;
}

/**
 * One audit row as the timeline reads it. `action` is an i18n key suffix, the
 * same convention the project trail uses, so the web renders it rather than
 * the API writing a sentence into a column.
 *
 * The interesting move on a permit is almost always the status, so that is
 * what the line names; everything else falls back to the columns that
 * changed, which is what tells somebody a window was moved after approval.
 */
export function toPermitAuditEntry(row: PermitAuditRow): AuditEntry {
  const before = row.before;
  const after = row.after;
  let action: string;
  let detail: string | null = null;

  if (row.entityType === "shutdown_permit") {
    if (row.action === "INSERT") {
      action = "permitRaised";
      detail = typeof after?.title_el === "string" ? after.title_el : null;
    } else if (before?.status !== after?.status && typeof after?.status === "string") {
      action = "permitStatusChanged";
      detail = `${String(before?.status ?? "")} → ${after.status}`;
    } else {
      action = "permitUpdated";
      const fields = changed(before, after);
      detail = fields.length ? fields.join(", ") : null;
    }
  } else if (row.entityType === "permit_approval") {
    if (row.action === "INSERT") {
      action = "permitRouted";
      detail = typeof after?.role === "string" ? after.role : null;
    } else if (row.action === "DELETE") {
      action = "permitRouteCleared";
      detail = typeof before?.role === "string" ? before.role : null;
    } else {
      action = "permitDecided";
      const role = String(after?.role ?? "");
      const decision = String(after?.decision ?? "");
      const comment = typeof after?.comment_el === "string" ? after.comment_el : "";
      detail = `${role}: ${decision}${comment ? ` — ${comment}` : ""}`;
    }
  } else if (row.action === "INSERT") {
    action = "permitAreaAdded";
    detail = typeof after?.impact === "string" ? after.impact : null;
  } else {
    action = "permitAreaRemoved";
    detail = typeof before?.impact === "string" ? before.impact : null;
  }

  return {
    id: String(row.id),
    // `seed` and `scheduler:breach` show as themselves rather than blank: a
    // flip nobody asked for still has somebody's name on it (R42).
    actorName: row.actorName ?? row.actorId ?? "",
    action,
    at: row.at.toISOString(),
    detail,
  };
}

/** Which columns moved, ignoring the ones every update touches. */
function changed(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): string[] {
  if (!before || !after) return [];
  const skip = new Set(["updated_at", "created_at"]);
  return Object.keys(after).filter(
    (key) => !skip.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
