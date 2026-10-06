/**
 * M5 — how a stored row becomes a contract shape, and the one SQL expression
 * the list filters timers with.
 *
 * The timers are computed on read (ADR-0031 §3: the deadlines are stored,
 * the state is not), so the list's `slaState` filter needs the same rule in
 * SQL that `workOrderSla` applies in TypeScript. Both are here, side by side,
 * so a change to one is a change made next to the other.
 */
import {
  BacklogItem,
  MaintenanceContract,
  PmSchedule,
  SlaSystem,
  WorkOrder,
  type SlaState,
} from "@ecapital/shared";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "../db/schema";
import { downtimeHours, workOrderSla } from "./maintenance-rules";

/** What the API says when the sweep, not a person, did something (R42 has no blank actor). */
export const SYSTEM_NAME_EL = "Σύστημα";

/** The statuses a PM order is still «open» in: one per schedule at a time (R32). */
export const OPEN_PM_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "PAUSED"] as const;

type WorkOrderRow = typeof schema.workOrder.$inferSelect;

export function iso(value: Date | string | null): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export function num(value: string | number | null): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** numeric(14,2) goes in as a string so no precision is lost on the way. */
export function money(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toFixed(2);
}

// ----------------------------------------------------------- the order --

/** The joined columns every read of an order carries. */
export const orderColumns = {
  order: schema.workOrder,
  contractorName: schema.contractor.name,
  slaSystemCode: schema.slaSystem.code,
  slaSystemName: schema.slaSystem.nameEl,
  assetTag: schema.asset.tag,
  assetName: schema.asset.nameEl,
  areaName: schema.area.nameEl,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.workOrder.raisedBy})`,
};

export interface OrderJoined {
  order: WorkOrderRow;
  contractorName: string | null;
  slaSystemCode: string | null;
  slaSystemName: string | null;
  assetTag: string | null;
  assetName: string | null;
  areaName: string | null;
  raisedByName: string | null;
}

export function timerFacts(order: WorkOrderRow) {
  return {
    kind: order.kind,
    status: order.status,
    calledAt: order.calledAt.toISOString(),
    dueResponseAt: iso(order.dueResponseAt),
    dueRestoreAt: iso(order.dueRestoreAt),
    dueReportAt: iso(order.dueReportAt),
    respondedAt: iso(order.respondedAt),
    restoredAt: iso(order.restoredAt),
    completedAt: iso(order.completedAt),
    reportReceivedAt: iso(order.reportReceivedAt),
    cancelledAt: iso(order.cancelledAt),
  };
}

export function toWorkOrder(row: OrderJoined, now: string): WorkOrder {
  const o = row.order;
  const facts = timerFacts(o);
  return WorkOrder.parse({
    id: o.id,
    ref: o.ref,
    orgUnitId: o.orgUnitId,
    kind: o.kind,
    status: o.status,
    source: o.source,
    maintenanceContractId: o.maintenanceContractId,
    contractorName: row.contractorName,
    slaSystemId: o.slaSystemId,
    slaSystemCode: row.slaSystemCode,
    slaSystemName: row.slaSystemName,
    band: o.band,
    assetId: o.assetId,
    assetTag: row.assetTag,
    assetName: row.assetName,
    areaId: o.areaId,
    areaName: row.areaName,
    pmScheduleId: o.pmScheduleId,
    titleEl: o.titleEl,
    descriptionEl: o.descriptionEl,
    calledAt: facts.calledAt,
    dueResponseAt: facts.dueResponseAt,
    dueRestoreAt: facts.dueRestoreAt,
    dueReportAt: facts.dueReportAt,
    dueDate: o.dueDate,
    respondedAt: facts.respondedAt,
    startedAt: iso(o.startedAt),
    restoredAt: facts.restoredAt,
    completedAt: facts.completedAt,
    reportReceivedAt: facts.reportReceivedAt,
    cancelledAt: facts.cancelledAt,
    extensionDays: o.extensionDays,
    extensionReasonEl: o.extensionReasonEl,
    failureCode: o.failureCode,
    causeCode: o.causeCode,
    remedyCode: o.remedyCode,
    costEstimate: num(o.costEstimate),
    costActual: num(o.costActual),
    partsNoteEl: o.partsNoteEl,
    closeoutNoteEl: o.closeoutNoteEl,
    assignedToEl: o.assignedToEl,
    raisedById: o.raisedBy,
    raisedByName: o.raisedBy ? (row.raisedByName ?? "") : SYSTEM_NAME_EL,
    escalatedAt: iso(o.escalatedAt),
    downtimeHours: downtimeHours(facts, now),
    sla: workOrderSla(facts, now),
    backlogItemId: o.backlogItemId,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  });
}

/**
 * `workOrderSla` in SQL, for the list's `slaState` filter. Same rule:
 * nothing on a cancelled order, PM has only the restore slot (met by
 * completion), the AMBER band is the last quarter of the distance from the
 * call to the deadline.
 */
export function slaStateSql(state: SlaState, now: string): SQL {
  const w = schema.workOrder;
  const timer = (due: SQL, met: SQL): SQL => sql`(case
      when ${due} is null then null
      when ${met} is not null then case when ${met} <= ${due} then 'GREEN' else 'BREACHED' end
      when ${now}::timestamptz > ${due} then 'RED'
      when ${now}::timestamptz >= ${due} - (${due} - ${w.calledAt}) * 0.25 then 'AMBER'
      else 'GREEN' end)`;
  const notCancelled = sql`${w.status} <> 'CANCELLED'`;
  const response = timer(sql`${w.dueResponseAt}`, sql`${w.respondedAt}`);
  const restoreTimed = timer(sql`${w.dueRestoreAt}`, sql`coalesce(${w.restoredAt}, ${w.completedAt})`);
  const restorePm = timer(sql`${w.dueRestoreAt}`, sql`${w.completedAt}`);
  const report = timer(sql`${w.dueReportAt}`, sql`${w.reportReceivedAt}`);
  return sql`(${notCancelled} and (
      (${w.kind} = 'PM' and ${restorePm} = ${state})
   or (${w.kind} <> 'PM' and (${response} = ${state} or ${restoreTimed} = ${state} or ${report} = ${state}))))`;
}

// ------------------------------------------------- agreement, catalogue --

type ContractRow = typeof schema.maintenanceContract.$inferSelect;
type SystemRow = typeof schema.slaSystem.$inferSelect;
type ScheduleRow = typeof schema.pmSchedule.$inferSelect;
type BacklogRow = typeof schema.backlogItem.$inferSelect;

export function toMaintenanceContract(
  row: ContractRow,
  contractorName: string,
  systemsCount: number,
): MaintenanceContract {
  return MaintenanceContract.parse({
    id: row.id,
    orgUnitId: row.orgUnitId,
    contractorId: row.contractorId,
    contractorName,
    contractId: row.contractId,
    ref: row.ref,
    titleEl: row.titleEl,
    startDate: row.startDate,
    endDate: row.endDate,
    roundTheClock: row.roundTheClock,
    normalHoursFrom: row.normalHoursFrom,
    normalHoursTo: row.normalHoursTo,
    availabilityHoursYear: row.availabilityHoursYear,
    availabilityPenaltyCriticalPerHour: Number(row.availabilityPenaltyCriticalPerHour),
    availabilityPenaltyOtherPerHour: Number(row.availabilityPenaltyOtherPerHour),
    penaltyCapPct: Number(row.penaltyCapPct),
    contractValue: num(row.contractValue),
    status: row.status,
    systemsCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function toSlaSystem(row: SystemRow): SlaSystem {
  return SlaSystem.parse({
    id: row.id,
    maintenanceContractId: row.maintenanceContractId,
    orgUnitId: row.orgUnitId,
    code: row.code,
    nameEl: row.nameEl,
    band: row.band,
    responseHours: Number(row.responseHours),
    restoreHours: Number(row.restoreHours),
    reportHours: Number(row.reportHours),
    pmFrequencies: row.pmFrequencies,
    penaltyPmPerDay: num(row.penaltyPmPerDay),
    penaltyResponsePerHour: num(row.penaltyResponsePerHour),
    penaltyRestorePerHour: num(row.penaltyRestorePerHour),
    assetClass: row.assetClass,
    permitSystem: row.permitSystem,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function toPmSchedule(
  row: ScheduleRow,
  extra: {
    slaSystemCode: string;
    slaSystemName: string;
    assetTag: string | null;
    assetName: string | null;
    openWorkOrderId: string | null;
  },
): PmSchedule {
  return PmSchedule.parse({
    id: row.id,
    orgUnitId: row.orgUnitId,
    maintenanceContractId: row.maintenanceContractId,
    slaSystemId: row.slaSystemId,
    slaSystemCode: extra.slaSystemCode,
    slaSystemName: extra.slaSystemName,
    assetId: row.assetId,
    assetTag: extra.assetTag,
    assetName: extra.assetName,
    titleEl: row.titleEl,
    frequency: row.frequency,
    checklistEl: row.checklistEl,
    nextDue: row.nextDue,
    leadDays: row.leadDays,
    active: row.active,
    lastGeneratedAt: iso(row.lastGeneratedAt),
    openWorkOrderId: extra.openWorkOrderId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

// ------------------------------------------------------------- backlog --

export const backlogColumns = {
  item: schema.backlogItem,
  assetTag: schema.asset.tag,
  assetName: schema.asset.nameEl,
  slaSystemName: schema.slaSystem.nameEl,
  sourceWorkOrderRef: schema.workOrder.ref,
  targetProjectCode: schema.project.code,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.backlogItem.raisedBy})`,
  unitName: schema.orgUnit.nameEl,
};

export interface BacklogJoined {
  item: BacklogRow;
  assetTag: string | null;
  assetName: string | null;
  slaSystemName: string | null;
  sourceWorkOrderRef: string | null;
  targetProjectCode: string | null;
  raisedByName: string | null;
  unitName: string;
}

export function toBacklogItem(row: BacklogJoined): BacklogItem {
  const i = row.item;
  return BacklogItem.parse({
    id: i.id,
    orgUnitId: i.orgUnitId,
    kind: i.kind,
    titleEl: i.titleEl,
    descriptionEl: i.descriptionEl,
    riskBand: i.riskBand,
    costEstimate: num(i.costEstimate),
    assetId: i.assetId,
    assetTag: row.assetTag,
    assetName: row.assetName,
    slaSystemId: i.slaSystemId,
    slaSystemName: row.slaSystemName,
    sourceWorkOrderId: i.sourceWorkOrderId,
    sourceWorkOrderRef: row.sourceWorkOrderRef,
    autoDrafted: i.autoDrafted,
    autoReason: i.autoReason,
    historyEl: i.historyEl,
    status: i.status,
    targetProjectId: i.targetProjectId,
    targetProjectCode: row.targetProjectCode,
    raisedById: i.raisedBy,
    raisedByName: i.raisedBy ? (row.raisedByName ?? "") : SYSTEM_NAME_EL,
    raisedAt: i.raisedAt.toISOString(),
    closedAt: iso(i.closedAt),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  });
}
