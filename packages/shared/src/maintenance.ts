import { z } from "zod";
import { AssetClass } from "./asset";
import { PermitSystem } from "./permit";
import { RiskBand, SlaState } from "./site";

// ------------------------------------------------------------ M5 (R32–R37)
// Συντήρηση: the umbrella maintenance agreement, its SLA catalogue, the
// preventive programme, work orders with the three contract timers, the
// failure/cause/remedy coding, the backlog by risk band and the contractor
// scorecard. ADR-0031 records the decisions.
//
// Built from a real contract (Γενικό Νοσοκομείο Λευκωσίας, Α.Ο 42/24, E&M
// maintenance, 6 years, 24/7): every system in the contract carries a band
// («Κρίσιμης Λειτουργίας», «Προτεραιότητας 1», «Προτεραιότητας 2») and
// three times measured **from the moment the call is sent** —
// response, restore, written report with cost estimate. Preventive
// maintenance runs to a monthly programme per equipment type. Penalties
// are per hour or per day late, withheld from the next quarterly payment,
// capped at 10% of the contract value. Availability is 8600 h/year per
// system, 5 €/h for critical equipment and 1 €/h for the rest below it.
//
// Owner answers, 06/10/2026: corrective calls are raised by the vendor's
// on-site team or by the nursing team alerting them on site; phones have
// reception, so offline execution (R40) is deferred.
//
// NO PATIENT DATA. A work order is a machine, a room, a clock and a name of
// the person who called it in. Never who was in the room.

// ------------------------------------------------------------- catalogue --

/** The contract's three priority bands, in the contract's own order. */
export const SlaBand = z.enum(["CRITICAL", "P1", "P2"]);
export type SlaBand = z.infer<typeof SlaBand>;

/** The frequencies the PM programme table uses («Μηνιαία», «Τριμηνιαία»…). */
export const PmFrequency = z.enum([
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
]);
export type PmFrequency = z.infer<typeof PmFrequency>;

export const MaintenanceContractStatus = z.enum(["ACTIVE", "ENDED"]);
export type MaintenanceContractStatus = z.infer<typeof MaintenanceContractStatus>;

/**
 * The umbrella agreement one unit has with one contractor. Not the same row
 * as `Contract` (a capital contract on a project): a maintenance agreement
 * has no project, runs for years and is measured by timers, not by a BOQ.
 * `contractId` links the CAP- record when finance has registered one.
 */
export const MaintenanceContract = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  contractorId: z.string(),
  contractorName: z.string(),
  contractId: z.string().nullable(),
  /** The tender or agreement number as written on the cover, e.g. «Α.Ο 42/24». */
  ref: z.string(),
  titleEl: z.string(),
  startDate: z.string(), // ISO date
  endDate: z.string().nullable(),
  /** 24/7 cover for corrective calls. False = normal hours only. */
  roundTheClock: z.boolean(),
  /** Normal working hours, «07:30»–«15:00» in the Nicosia contract. PM runs inside them. */
  normalHoursFrom: z.string(),
  normalHoursTo: z.string(),
  /** Contract clause: hours per year each system must be available (8600). */
  availabilityHoursYear: z.number().int().positive(),
  availabilityPenaltyCriticalPerHour: z.number().nonnegative(),
  availabilityPenaltyOtherPerHour: z.number().nonnegative(),
  /** Penalties above this share of the contract value allow termination (10). */
  penaltyCapPct: z.number().min(0).max(100),
  contractValue: z.number().nonnegative().nullable(),
  status: MaintenanceContractStatus,
  systemsCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MaintenanceContract = z.infer<typeof MaintenanceContract>;

export const MaintenanceContractWrite = MaintenanceContract.omit({
  id: true,
  contractorName: true,
  systemsCount: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  contractId: true,
  endDate: true,
  roundTheClock: true,
  normalHoursFrom: true,
  normalHoursTo: true,
  availabilityHoursYear: true,
  availabilityPenaltyCriticalPerHour: true,
  availabilityPenaltyOtherPerHour: true,
  penaltyCapPct: true,
  contractValue: true,
  status: true,
});
export type MaintenanceContractWrite = z.infer<typeof MaintenanceContractWrite>;

/**
 * One line of the contract's response-time table: a system, its band and
 * the three timers. The penalty rates are per hour (response, restore) and
 * per day (PM) and are **nullable on purpose**: the Nicosia contract's
 * penalty table lost its amounts in the copy we were given, so the
 * scorecard says «rates missing» instead of inventing a figure.
 */
export const SlaSystem = z.object({
  id: z.string(),
  maintenanceContractId: z.string(),
  orgUnitId: z.string(),
  /** The table's own numbering, e.g. «1.2.4». Unique within the contract. */
  code: z.string(),
  nameEl: z.string(),
  band: SlaBand,
  responseHours: z.number().positive(),
  restoreHours: z.number().positive(),
  reportHours: z.number().positive(),
  pmFrequencies: z.array(PmFrequency),
  penaltyPmPerDay: z.number().nonnegative().nullable(),
  penaltyResponsePerHour: z.number().nonnegative().nullable(),
  penaltyRestorePerHour: z.number().nonnegative().nullable(),
  /** What register class and what shutdown system this line maps to, when it does. */
  assetClass: AssetClass.nullable(),
  permitSystem: PermitSystem.nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SlaSystem = z.infer<typeof SlaSystem>;

export const SlaSystemWrite = SlaSystem.omit({
  id: true,
  orgUnitId: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  pmFrequencies: true,
  penaltyPmPerDay: true,
  penaltyResponsePerHour: true,
  penaltyRestorePerHour: true,
  assetClass: true,
  permitSystem: true,
  active: true,
});
export type SlaSystemWrite = z.infer<typeof SlaSystemWrite>;

/**
 * R32: the SLA importer's result. The upload is an .xlsx with one row per
 * system — code, name, band, the three hour columns, the PM frequencies and
 * the three optional rates — matched to existing rows by code.
 */
export const SlaImportResult = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      row: z.number().int().positive(),
      messageEl: z.string(),
    }),
  ),
});
export type SlaImportResult = z.infer<typeof SlaImportResult>;

// ------------------------------------------------------------- programme --

/**
 * One line of the preventive programme: a system (or one asset of it), a
 * frequency and the next due date. The scheduler turns it into a PM work
 * order `leadDays` before `nextDue` and moves `nextDue` on by the
 * frequency. Re-running never doubles a work order: one open PM order per
 * schedule at a time.
 */
export const PmSchedule = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  maintenanceContractId: z.string(),
  slaSystemId: z.string(),
  slaSystemCode: z.string(),
  slaSystemName: z.string(),
  assetId: z.string().nullable(),
  assetTag: z.string().nullable(),
  assetName: z.string().nullable(),
  titleEl: z.string(),
  frequency: PmFrequency,
  /** The checklist the contractor's form carries, one line per item. */
  checklistEl: z.string().nullable(),
  nextDue: z.string(), // ISO date
  leadDays: z.number().int().min(0).max(90),
  active: z.boolean(),
  lastGeneratedAt: z.string().nullable(),
  openWorkOrderId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PmSchedule = z.infer<typeof PmSchedule>;

export const PmScheduleWrite = PmSchedule.omit({
  id: true,
  orgUnitId: true,
  maintenanceContractId: true,
  slaSystemCode: true,
  slaSystemName: true,
  assetTag: true,
  assetName: true,
  lastGeneratedAt: true,
  openWorkOrderId: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  assetId: true,
  checklistEl: true,
  leadDays: true,
  active: true,
});
export type PmScheduleWrite = z.infer<typeof PmScheduleWrite>;

/** What one pass of the generator did. The admin's «Έκδοση τώρα» shows it. */
export const PmGenerationResult = z.object({
  generated: z.number().int().nonnegative(),
  skippedOpen: z.number().int().nonnegative(),
  escalated: z.number().int().nonnegative(),
});
export type PmGenerationResult = z.infer<typeof PmGenerationResult>;

// ----------------------------------------------------------- work orders --

export const WorkOrderKind = z.enum(["CORRECTIVE", "PM", "STATUTORY"]);
export type WorkOrderKind = z.infer<typeof WorkOrderKind>;

/**
 * The life of an order. Corrective: OPEN → ACKNOWLEDGED (the contractor
 * responded) → IN_PROGRESS ⇄ PAUSED → RESTORED (the system works again;
 * the report is still owed) → COMPLETED (report and cost received, coded).
 * PM: OPEN → IN_PROGRESS → COMPLETED. CANCELLED from OPEN or ACKNOWLEDGED
 * with a reason, never later.
 */
export const WorkOrderStatus = z.enum([
  "OPEN",
  "ACKNOWLEDGED",
  "IN_PROGRESS",
  "PAUSED",
  "RESTORED",
  "COMPLETED",
  "CANCELLED",
]);
export type WorkOrderStatus = z.infer<typeof WorkOrderStatus>;

/** Who raised the call (owner answer 06/10/2026). */
export const WorkOrderSource = z.enum([
  "VENDOR_ONSITE",
  "NURSING",
  "TECHNICAL_SERVICES",
  "PM_PROGRAMME",
  "OTHER",
]);
export type WorkOrderSource = z.infer<typeof WorkOrderSource>;

// R34 — failure / cause / remedy coding. Short lists a technician picks
// from on a phone. The scorecard and the backlog rule read `causeCode`.
export const FailureCode = z.enum([
  "NO_OUTPUT",
  "DEGRADED",
  "LEAK",
  "NOISE_VIBRATION",
  "ELECTRICAL_FAULT",
  "CONTROL_FAULT",
  "ALARM",
  "DAMAGE",
  "OTHER",
]);
export type FailureCode = z.infer<typeof FailureCode>;

export const CauseCode = z.enum([
  "WEAR",
  "LACK_OF_PM",
  "MISUSE",
  "POWER_SUPPLY",
  "ENVIRONMENT",
  "DESIGN",
  "EXTERNAL",
  "UNKNOWN",
]);
export type CauseCode = z.infer<typeof CauseCode>;

export const RemedyCode = z.enum([
  "REPAIR",
  "REPLACE_PART",
  "REPLACE_UNIT",
  "ADJUST",
  "CLEAN",
  "RESET",
  "TEMPORARY_FIX",
  "NO_FAULT_FOUND",
]);
export type RemedyCode = z.infer<typeof RemedyCode>;

/**
 * The three contract timers on one order, each as the SlaChip's state.
 * GREEN = inside the time, AMBER = inside the last quarter of it, RED =
 * overdue and still open, BREACHED = met late (the clock stopped after the
 * deadline). A PM order has no response or report timer; its restore slot
 * carries the due date.
 */
export const WorkOrderSla = z.object({
  response: SlaState.nullable(),
  restore: SlaState.nullable(),
  report: SlaState.nullable(),
});
export type WorkOrderSla = z.infer<typeof WorkOrderSla>;

export const WorkOrder = z.object({
  id: z.string(),
  /** `<UNITCODE>-WO-<YEAR>-<NNNN>`, allocated by the API, immutable (ADR-0014's pattern). */
  ref: z.string(),
  orgUnitId: z.string(),
  kind: WorkOrderKind,
  status: WorkOrderStatus,
  source: WorkOrderSource,
  maintenanceContractId: z.string().nullable(),
  contractorName: z.string().nullable(),
  slaSystemId: z.string().nullable(),
  slaSystemCode: z.string().nullable(),
  slaSystemName: z.string().nullable(),
  band: SlaBand.nullable(),
  assetId: z.string().nullable(),
  assetTag: z.string().nullable(),
  assetName: z.string().nullable(),
  areaId: z.string().nullable(),
  areaName: z.string().nullable(),
  pmScheduleId: z.string().nullable(),
  titleEl: z.string(),
  descriptionEl: z.string().nullable(),
  /** RULE (contract note *): every timer counts from the moment the call was sent. */
  calledAt: z.string(),
  dueResponseAt: z.string().nullable(),
  dueRestoreAt: z.string().nullable(),
  dueReportAt: z.string().nullable(),
  /** PM only: the programme date. */
  dueDate: z.string().nullable(),
  respondedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  restoredAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  reportReceivedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  /**
   * Contract note 2: a spare that has to be imported extends the restore
   * time by five working days (fifteen for chiller compressors), granted
   * by the coordinator with a reason. The restore deadline moves; the
   * response one never does.
   */
  extensionDays: z.number().int().nonnegative(),
  extensionReasonEl: z.string().nullable(),
  failureCode: FailureCode.nullable(),
  causeCode: CauseCode.nullable(),
  remedyCode: RemedyCode.nullable(),
  costEstimate: z.number().nonnegative().nullable(),
  costActual: z.number().nonnegative().nullable(),
  partsNoteEl: z.string().nullable(),
  closeoutNoteEl: z.string().nullable(),
  /** The contractor's technician, as a name typed on the order. Not a user. */
  assignedToEl: z.string().nullable(),
  /**
   * Null when the hourly programme sweep issued the order and nobody asked
   * for it (a PM order from «Έκδοση τώρα» carries the caller). The name then
   * reads «Σύστημα».
   */
  raisedById: z.string().nullable(),
  raisedByName: z.string(),
  /** Set once by the sweep when the response time passed with nobody responding. */
  escalatedAt: z.string().nullable(),
  /** Hours the system was down: calledAt to restoredAt (or now while open). Corrective only. */
  downtimeHours: z.number().nonnegative().nullable(),
  sla: WorkOrderSla,
  backlogItemId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkOrder = z.infer<typeof WorkOrder>;

/** S20 — the call. Phone-first, so the fewest fields that make an order. */
export const WorkOrderCreate = z.object({
  kind: z.enum(["CORRECTIVE", "STATUTORY"]),
  source: WorkOrderSource,
  /** Required when there is no asset to take the unit from. */
  orgUnitId: z.string().optional(),
  slaSystemId: z.string().nullable().optional(),
  assetId: z.string().nullable().optional(),
  areaId: z.string().nullable().optional(),
  titleEl: z.string().min(3).max(200),
  descriptionEl: z.string().max(4000).nullable().optional(),
  /** Defaults to now. Earlier when the call was sent by phone and typed later. */
  calledAt: z.string().datetime().optional(),
  assignedToEl: z.string().max(200).nullable().optional(),
});
export type WorkOrderCreate = z.infer<typeof WorkOrderCreate>;

export const WorkOrderPatch = z
  .object({
    titleEl: z.string().min(3).max(200),
    descriptionEl: z.string().max(4000).nullable(),
    slaSystemId: z.string().nullable(),
    assetId: z.string().nullable(),
    areaId: z.string().nullable(),
    assignedToEl: z.string().max(200).nullable(),
    failureCode: FailureCode.nullable(),
    causeCode: CauseCode.nullable(),
    remedyCode: RemedyCode.nullable(),
    costEstimate: z.number().nonnegative().nullable(),
    costActual: z.number().nonnegative().nullable(),
    partsNoteEl: z.string().max(2000).nullable(),
    extensionDays: z.number().int().min(0).max(60),
    extensionReasonEl: z.string().max(1000).nullable(),
  })
  .partial();
export type WorkOrderPatch = z.infer<typeof WorkOrderPatch>;

/** S19's buttons and the desktop actions. The API refuses a step out of order. */
export const WorkOrderAction = z.enum([
  "ACKNOWLEDGE",
  "START",
  "PAUSE",
  "RESUME",
  "RESTORE",
  "COMPLETE",
  "CANCEL",
]);
export type WorkOrderAction = z.infer<typeof WorkOrderAction>;

export const WorkOrderTransition = z.object({
  action: WorkOrderAction,
  /** When it happened, if not now (a call answered by phone an hour ago). */
  at: z.string().datetime().optional(),
  noteEl: z.string().max(2000).nullable().optional(),
  /** COMPLETE on a corrective order needs the three codes; they may ride here. */
  failureCode: FailureCode.optional(),
  causeCode: CauseCode.optional(),
  remedyCode: RemedyCode.optional(),
  costActual: z.number().nonnegative().optional(),
  /** COMPLETE: the contractor's written report arrived (defaults to `at`). */
  reportReceivedAt: z.string().datetime().optional(),
});
export type WorkOrderTransition = z.infer<typeof WorkOrderTransition>;

export const WorkOrderEventKind = z.enum([
  "CREATED",
  "ACKNOWLEDGED",
  "STARTED",
  "PAUSED",
  "RESUMED",
  "RESTORED",
  "COMPLETED",
  "CANCELLED",
  "NOTE",
  "ESCALATED",
  "EXTENSION",
  "CODED",
  "PHOTO",
  "TO_BACKLOG",
  "EDITED",
]);
export type WorkOrderEventKind = z.infer<typeof WorkOrderEventKind>;

export const WorkOrderEvent = z.object({
  id: z.string(),
  workOrderId: z.string(),
  at: z.string(),
  byId: z.string().nullable(),
  byName: z.string(),
  kind: WorkOrderEventKind,
  noteEl: z.string().nullable(),
  /** A photo or the contractor's report, filed with eArchive like an asset's papers. */
  documentId: z.string().nullable(),
  documentTitle: z.string().nullable(),
});
export type WorkOrderEvent = z.infer<typeof WorkOrderEvent>;

export const WorkOrderDetail = WorkOrder.extend({
  events: z.array(WorkOrderEvent),
  /** The checklist from the schedule, for PM orders. */
  checklistEl: z.string().nullable(),
  /** Corrective orders on the same asset in the last twelve months, this one included. */
  repeatCount: z.number().int().nonnegative(),
});
export type WorkOrderDetail = z.infer<typeof WorkOrderDetail>;

export const WorkOrderListQuery = z.object({
  orgUnitId: z.string().optional(),
  kind: WorkOrderKind.optional(),
  status: z.array(WorkOrderStatus).optional(),
  band: SlaBand.optional(),
  /** Only orders with at least one timer in this state. */
  slaState: SlaState.optional(),
  assetId: z.string().optional(),
  slaSystemId: z.string().optional(),
  maintenanceContractId: z.string().optional(),
  /** Only the orders raised by the caller (the technician's own list on a phone). */
  mine: z.boolean().optional(),
  from: z.string().optional(), // calledAt >= (ISO date)
  to: z.string().optional(), // calledAt < (ISO date, exclusive)
  q: z.string().optional(),
  sort: z.enum(["calledAt", "ref", "status", "band", "dueRestoreAt"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type WorkOrderListQuery = z.infer<typeof WorkOrderListQuery>;

export const WorkOrderListRow = WorkOrder.pick({
  id: true,
  ref: true,
  orgUnitId: true,
  kind: true,
  status: true,
  source: true,
  band: true,
  slaSystemName: true,
  assetTag: true,
  assetName: true,
  areaName: true,
  titleEl: true,
  calledAt: true,
  dueResponseAt: true,
  dueRestoreAt: true,
  dueReportAt: true,
  dueDate: true,
  respondedAt: true,
  restoredAt: true,
  completedAt: true,
  escalatedAt: true,
  contractorName: true,
  sla: true,
});
export type WorkOrderListRow = z.infer<typeof WorkOrderListRow>;

/** S18's tiles. One query, the caller's units. */
export const MaintenanceSummary = z.object({
  open: z.number().int().nonnegative(),
  overdueResponse: z.number().int().nonnegative(),
  overdueRestore: z.number().int().nonnegative(),
  pmDueThisMonth: z.number().int().nonnegative(),
  pmOverdue: z.number().int().nonnegative(),
  backlogUnfundedEur: z.number().nonnegative(),
});
export type MaintenanceSummary = z.infer<typeof MaintenanceSummary>;

// --------------------------------------------------------------- backlog --

export const BacklogKind = z.enum(["REPAIR", "REPLACEMENT", "UPGRADE", "STATUTORY"]);
export type BacklogKind = z.infer<typeof BacklogKind>;

export const BacklogStatus = z.enum(["OPEN", "FUNDED", "DONE", "DROPPED"]);
export type BacklogStatus = z.infer<typeof BacklogStatus>;

/** R36: why the system drafted an item by itself. */
export const BacklogAutoReason = z.enum([
  "THREE_CORRECTIVE_IN_12_MONTHS",
  "REPAIR_COST_OVER_THRESHOLD",
]);
export type BacklogAutoReason = z.infer<typeof BacklogAutoReason>;

/**
 * R35: work the contract will not absorb — a repair the budget has no
 * line for, a replacement, an upgrade, a statutory gap. Each carries a
 * risk band (NHS ERIC, the same four as a defect) and a cost estimate; the
 * unfunded sum by unit and band is next year's capital programme input.
 */
export const BacklogItem = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  kind: BacklogKind,
  titleEl: z.string(),
  descriptionEl: z.string().nullable(),
  riskBand: RiskBand,
  costEstimate: z.number().nonnegative().nullable(),
  assetId: z.string().nullable(),
  assetTag: z.string().nullable(),
  assetName: z.string().nullable(),
  slaSystemId: z.string().nullable(),
  slaSystemName: z.string().nullable(),
  sourceWorkOrderId: z.string().nullable(),
  sourceWorkOrderRef: z.string().nullable(),
  autoDrafted: z.boolean(),
  autoReason: BacklogAutoReason.nullable(),
  /** The history the auto-draft attached: order refs, dates, costs. Read-only text. */
  historyEl: z.string().nullable(),
  status: BacklogStatus,
  targetProjectId: z.string().nullable(),
  targetProjectCode: z.string().nullable(),
  raisedById: z.string().nullable(),
  raisedByName: z.string(),
  raisedAt: z.string(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BacklogItem = z.infer<typeof BacklogItem>;

export const BacklogCreate = z.object({
  orgUnitId: z.string().optional(),
  kind: BacklogKind,
  titleEl: z.string().min(3).max(200),
  descriptionEl: z.string().max(4000).nullable().optional(),
  riskBand: RiskBand,
  costEstimate: z.number().nonnegative().nullable().optional(),
  assetId: z.string().nullable().optional(),
  slaSystemId: z.string().nullable().optional(),
  sourceWorkOrderId: z.string().nullable().optional(),
});
export type BacklogCreate = z.infer<typeof BacklogCreate>;

export const BacklogPatch = z
  .object({
    kind: BacklogKind,
    titleEl: z.string().min(3).max(200),
    descriptionEl: z.string().max(4000).nullable(),
    riskBand: RiskBand,
    costEstimate: z.number().nonnegative().nullable(),
    status: BacklogStatus,
    targetProjectId: z.string().nullable(),
  })
  .partial();
export type BacklogPatch = z.infer<typeof BacklogPatch>;

/** «Σε έργο»: drafts a project at the Idea phase from the item and funds it. */
export const BacklogToProject = z.object({
  titleEl: z.string().min(3).max(200).optional(),
});
export type BacklogToProject = z.infer<typeof BacklogToProject>;

export const BacklogListQuery = z.object({
  orgUnitId: z.string().optional(),
  riskBand: RiskBand.optional(),
  status: z.array(BacklogStatus).optional(),
  kind: BacklogKind.optional(),
  assetId: z.string().optional(),
  autoDrafted: z.boolean().optional(),
  q: z.string().optional(),
  sort: z.enum(["riskBand", "costEstimate", "raisedAt", "status"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});
export type BacklogListQuery = z.infer<typeof BacklogListQuery>;

/** S21's totals: one row per unit and band over OPEN and FUNDED items. */
export const BacklogSummaryRow = z.object({
  orgUnitId: z.string(),
  unitName: z.string(),
  riskBand: RiskBand,
  count: z.number().int().nonnegative(),
  costEstimate: z.number().nonnegative(),
  fundedCost: z.number().nonnegative(),
  unfundedCost: z.number().nonnegative(),
});
export type BacklogSummaryRow = z.infer<typeof BacklogSummaryRow>;

// ------------------------------------------------------------- scorecard --

const Ratio = z.object({
  due: z.number().int().nonnegative(),
  onTime: z.number().int().nonnegative(),
  /** null when nothing was due. */
  pct: z.number().min(0).max(100).nullable(),
});

/**
 * R37: one contractor, one period. Computed on read from the orders, never
 * stored, so the figures always agree with the list. Penalty figures use
 * the catalogue rates; where a rate is null the line is counted and the
 * amount is left out, and `ratesMissing` says so.
 */
export const Scorecard = z.object({
  maintenanceContractId: z.string(),
  contractorName: z.string(),
  contractRef: z.string(),
  from: z.string(),
  to: z.string(),
  workOrders: z.object({
    total: z.number().int().nonnegative(),
    corrective: z.number().int().nonnegative(),
    pm: z.number().int().nonnegative(),
    statutory: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
  }),
  response: Ratio,
  restore: Ratio,
  report: Ratio,
  pm: Ratio,
  availability: z.object({
    criticalDowntimeHours: z.number().nonnegative(),
    otherDowntimeHours: z.number().nonnegative(),
    /** Hours allowed down in the period, pro rata from the yearly figure. */
    allowanceHours: z.number().nonnegative(),
    penaltyEur: z.number().nonnegative(),
  }),
  penalties: z.object({
    pmEur: z.number().nonnegative(),
    responseEur: z.number().nonnegative(),
    restoreEur: z.number().nonnegative(),
    availabilityEur: z.number().nonnegative(),
    totalEur: z.number().nonnegative(),
    /** Share of the contract value, null without a value. */
    capUsedPct: z.number().nonnegative().nullable(),
    ratesMissing: z.boolean(),
  }),
  /** Assets with three or more corrective orders inside the period. */
  repeatFailures: z.number().int().nonnegative(),
  byBand: z.array(
    z.object({
      band: SlaBand,
      corrective: z.number().int().nonnegative(),
      responseOnTimePct: z.number().min(0).max(100).nullable(),
      restoreOnTimePct: z.number().min(0).max(100).nullable(),
      downtimeHours: z.number().nonnegative(),
    }),
  ),
});
export type Scorecard = z.infer<typeof Scorecard>;

export const ScorecardQuery = z.object({
  maintenanceContractId: z.string(),
  from: z.string(), // ISO date, inclusive
  to: z.string(), // ISO date, exclusive
});
export type ScorecardQuery = z.infer<typeof ScorecardQuery>;

// ----------------------------------------------------------------- rules --

/**
 * Business rules both ends apply (CAPEX-01 §15: unit tests on SLA state).
 * Pure functions over ISO strings so a test needs no clock of its own.
 */

/** The last quarter of a timer is AMBER (the RFI rule, ADR-0017). */
export const SLA_AMBER_FRACTION = 0.25;

/**
 * R36 thresholds. Three corrective orders on one asset inside twelve
 * months, or repair cost in those months above this share of the asset's
 * replacement estimate, drafts a replacement item. The brief leaves the
 * percentage open («X%»); fifty is the ADR-0031 assumption.
 */
export const BACKLOG_REPEAT_COUNT = 3;
export const BACKLOG_REPAIR_COST_PCT = 50;

/** Contract note 2: extension for an imported spare. Working days. */
export const EXTENSION_DAYS_SPARE = 5;
export const EXTENSION_DAYS_CHILLER_COMPRESSOR = 15;

export function slaStateOf(
  dueAt: string | null,
  metAt: string | null,
  now: string,
  totalHours: number | null,
): SlaState | null {
  if (!dueAt) return null;
  const due = Date.parse(dueAt);
  if (metAt) return Date.parse(metAt) <= due ? "GREEN" : "BREACHED";
  const at = Date.parse(now);
  if (at > due) return "RED";
  if (totalHours && totalHours > 0) {
    const amberFrom = due - totalHours * 3_600_000 * SLA_AMBER_FRACTION;
    if (at >= amberFrom) return "AMBER";
  }
  return "GREEN";
}

export function addHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * 3_600_000).toISOString();
}

/** The next programme date after `from` for a frequency. Dates only, local-free. */
export function nextDueAfter(from: string, frequency: PmFrequency): string {
  const d = new Date(`${from.slice(0, 10)}T00:00:00Z`);
  switch (frequency) {
    case "DAILY":
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case "WEEKLY":
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case "MONTHLY":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "QUARTERLY":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "SEMIANNUAL":
      d.setUTCMonth(d.getUTCMonth() + 6);
      break;
    case "ANNUAL":
      d.setUTCFullYear(d.getUTCFullYear() + 1);
      break;
  }
  return d.toISOString().slice(0, 10);
}

/** How many programme visits a frequency means in a year. The scorecard's PM denominator. */
export const PM_VISITS_PER_YEAR: Record<PmFrequency, number> = {
  DAILY: 365,
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  ANNUAL: 1,
};

/** The transitions the API allows, by current status. */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderStatus, WorkOrderAction[]> = {
  OPEN: ["ACKNOWLEDGE", "START", "CANCEL"],
  ACKNOWLEDGED: ["START", "CANCEL"],
  IN_PROGRESS: ["PAUSE", "RESTORE", "COMPLETE"],
  PAUSED: ["RESUME"],
  RESTORED: ["COMPLETE"],
  COMPLETED: [],
  CANCELLED: [],
};

/** The status an action lands on. */
export const WORK_ORDER_ACTION_TARGET: Record<WorkOrderAction, WorkOrderStatus> = {
  ACKNOWLEDGE: "ACKNOWLEDGED",
  START: "IN_PROGRESS",
  PAUSE: "PAUSED",
  RESUME: "IN_PROGRESS",
  RESTORE: "RESTORED",
  COMPLETE: "COMPLETED",
  CANCEL: "CANCELLED",
};
