// M5 maintenance (R32–R37, ADR-0031) — fixtures shared by the unit tests and
// the /preview gallery. Same posture as `./efinance.ts`: there is no
// request-mocking layer in this app (the hooks go through the same-origin
// proxy to the real API), so "a mock for every new endpoint" is a builder
// per response shape. Each returns exactly what the contract in
// `packages/shared/src/maintenance.ts` accepts — `maintenance.test.ts` next
// to this file parses every one of them — so a screen is tested on the real
// DTO and not on a hand-shaped object.
//
// Obviously fake figures and names. NO PATIENT DATA: a work order is a
// machine, a room, a clock and the name of whoever called it in.
import type {
  BacklogItem,
  BacklogSummaryRow,
  MaintenanceContract,
  MaintenanceSummary,
  PmGenerationResult,
  PmSchedule,
  Scorecard,
  SlaImportResult,
  SlaSystem,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderEvent,
  WorkOrderListRow,
} from "@ecapital/shared";

const UNIT = "nicosia-general";
const AGREEMENT = "mc-1";

/** GET /maintenance/summary */
export function buildMaintenanceSummary(overrides: Partial<MaintenanceSummary> = {}): MaintenanceSummary {
  return {
    open: 14,
    overdueResponse: 1,
    overdueRestore: 2,
    pmDueThisMonth: 9,
    pmOverdue: 1,
    backlogUnfundedEur: 412_500,
    ...overrides,
  };
}

/** GET /maintenance/contracts/:id */
export function buildMaintenanceContract(overrides: Partial<MaintenanceContract> = {}): MaintenanceContract {
  return {
    id: AGREEMENT,
    orgUnitId: UNIT,
    contractorId: "ctr-1",
    contractorName: "Δείγμα Η/Μ Συντήρηση Λτδ",
    contractId: null,
    ref: "Α.Ο 42/24",
    titleEl: "Συντήρηση ηλεκτρομηχανολογικών εγκαταστάσεων",
    startDate: "2025-01-01",
    endDate: "2030-12-31",
    roundTheClock: true,
    normalHoursFrom: "07:30",
    normalHoursTo: "15:00",
    availabilityHoursYear: 8600,
    availabilityPenaltyCriticalPerHour: 5,
    availabilityPenaltyOtherPerHour: 1,
    penaltyCapPct: 10,
    contractValue: 6_000_000,
    status: "ACTIVE",
    systemsCount: 3,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

/** One row of GET /maintenance/contracts/:id/systems. Rates null on purpose (ADR-0031 §2). */
export function buildSlaSystem(overrides: Partial<SlaSystem> = {}): SlaSystem {
  return {
    id: "sla-1",
    maintenanceContractId: AGREEMENT,
    orgUnitId: UNIT,
    code: "1.1.1",
    nameEl: "Σύστημα κλιματισμού χειρουργείων και ΜΕΘ",
    band: "CRITICAL",
    responseHours: 0.5,
    restoreHours: 2,
    reportHours: 24,
    pmFrequencies: ["MONTHLY", "SEMIANNUAL"],
    penaltyPmPerDay: null,
    penaltyResponsePerHour: null,
    penaltyRestorePerHour: null,
    assetClass: "HVAC",
    permitSystem: null,
    active: true,
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

export function buildSlaSystems(): SlaSystem[] {
  return [
    buildSlaSystem(),
    buildSlaSystem({
      id: "sla-2",
      code: "1.2.4",
      nameEl: "Ανελκυστήρες ασθενών",
      band: "P1",
      responseHours: 0.5,
      restoreHours: 24,
      reportHours: 48,
      pmFrequencies: ["MONTHLY"],
      assetClass: "LIFT",
      penaltyResponsePerHour: 50,
      penaltyRestorePerHour: 20,
      penaltyPmPerDay: 10,
    }),
    buildSlaSystem({
      id: "sla-3",
      code: "1.3.2",
      nameEl: "Φωτισμός διαδρόμων",
      band: "P2",
      responseHours: 1,
      restoreHours: 48,
      reportHours: 72,
      pmFrequencies: ["QUARTERLY"],
      assetClass: "ELECTRICAL",
    }),
  ];
}

export function buildSlaImportResult(overrides: Partial<SlaImportResult> = {}): SlaImportResult {
  return {
    created: 2,
    updated: 45,
    skipped: 1,
    errors: [{ row: 17, messageEl: "Λείπει η ζώνη προτεραιότητας." }],
    ...overrides,
  };
}

/** One row of GET /maintenance/schedules */
export function buildPmSchedule(overrides: Partial<PmSchedule> = {}): PmSchedule {
  return {
    id: "pm-1",
    orgUnitId: UNIT,
    maintenanceContractId: AGREEMENT,
    slaSystemId: "sla-1",
    slaSystemCode: "1.1.1",
    slaSystemName: "Σύστημα κλιματισμού χειρουργείων και ΜΕΘ",
    assetId: "asset-1",
    assetTag: "NGH-HVAC-0001",
    assetName: "Ψύκτης Ψ-Λ1",
    titleEl: "Μηνιαίος έλεγχος ψύκτη",
    frequency: "MONTHLY",
    checklistEl: "Έλεγχος πιέσεων ψυκτικού\nΚαθαρισμός φίλτρων\nΈλεγχος συναγερμών",
    nextDue: "2026-10-15",
    leadDays: 5,
    active: true,
    lastGeneratedAt: "2026-09-10T06:00:00.000Z",
    openWorkOrderId: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-09-10T06:00:00.000Z",
    ...overrides,
  };
}

export function buildPmGenerationResult(overrides: Partial<PmGenerationResult> = {}): PmGenerationResult {
  return { generated: 4, skippedOpen: 2, escalated: 1, ...overrides };
}

/** A corrective order called at 06/10/2026 08:00 Nicosia time, acknowledged, not yet restored. */
export function buildWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: "wo-1",
    ref: "NGH-WO-2026-0042",
    orgUnitId: UNIT,
    kind: "CORRECTIVE",
    status: "ACKNOWLEDGED",
    source: "NURSING",
    maintenanceContractId: AGREEMENT,
    contractorName: "Δείγμα Η/Μ Συντήρηση Λτδ",
    slaSystemId: "sla-2",
    slaSystemCode: "1.2.4",
    slaSystemName: "Ανελκυστήρες ασθενών",
    band: "P1",
    assetId: "asset-2",
    assetTag: "NGH-LIFT-0003",
    assetName: "Ανελκυστήρας Α3",
    areaId: "area-1",
    areaName: "Κεντρικός διάδρομος, ισόγειο",
    pmScheduleId: null,
    titleEl: "Ο ανελκυστήρας σταματά ανάμεσα σε ορόφους",
    descriptionEl: "Σταματά ανάμεσα στον 2ο και τον 3ο όροφο. Οι πόρτες ανοίγουν με το χέρι.",
    calledAt: "2026-10-06T05:00:00.000Z",
    dueResponseAt: "2026-10-06T05:30:00.000Z",
    dueRestoreAt: "2026-10-07T05:00:00.000Z",
    dueReportAt: "2026-10-08T05:00:00.000Z",
    dueDate: null,
    respondedAt: "2026-10-06T05:20:00.000Z",
    startedAt: null,
    restoredAt: null,
    completedAt: null,
    reportReceivedAt: null,
    cancelledAt: null,
    extensionDays: 0,
    extensionReasonEl: null,
    failureCode: null,
    causeCode: null,
    remedyCode: null,
    costEstimate: null,
    costActual: null,
    partsNoteEl: null,
    closeoutNoteEl: null,
    assignedToEl: "Α. Τεχνικού",
    raisedById: "user-nursing",
    raisedByName: "Ν. Νοσηλευτή",
    escalatedAt: null,
    downtimeHours: 6,
    sla: { response: "GREEN", restore: "GREEN", report: "GREEN" },
    backlogItemId: null,
    createdAt: "2026-10-06T05:00:00.000Z",
    updatedAt: "2026-10-06T05:20:00.000Z",
    ...overrides,
  };
}

/** A PM order: no response or report timer; the programme date sits in `dueDate`. */
export function buildPmWorkOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return buildWorkOrder({
    id: "wo-2",
    ref: "NGH-WO-2026-0043",
    kind: "PM",
    status: "OPEN",
    source: "PM_PROGRAMME",
    slaSystemId: "sla-1",
    slaSystemCode: "1.1.1",
    slaSystemName: "Σύστημα κλιματισμού χειρουργείων και ΜΕΘ",
    band: "CRITICAL",
    assetId: "asset-1",
    assetTag: "NGH-HVAC-0001",
    assetName: "Ψύκτης Ψ-Λ1",
    areaId: null,
    areaName: "Δώμα νέας πτέρυγας",
    pmScheduleId: "pm-1",
    titleEl: "Μηνιαίος έλεγχος ψύκτη",
    descriptionEl: null,
    calledAt: "2026-10-10T04:00:00.000Z",
    dueResponseAt: null,
    dueRestoreAt: null,
    dueReportAt: "2026-10-22T00:00:00.000Z",
    dueDate: "2026-10-15",
    respondedAt: null,
    downtimeHours: null,
    assignedToEl: null,
    raisedById: "system",
    raisedByName: "Πρόγραμμα ΠΣ",
    sla: { response: null, restore: "GREEN", report: null },
    ...overrides,
  });
}

export function buildWorkOrderListRow(overrides: Partial<WorkOrder> = {}): WorkOrderListRow {
  const wo = buildWorkOrder(overrides);
  return {
    id: wo.id,
    ref: wo.ref,
    orgUnitId: wo.orgUnitId,
    kind: wo.kind,
    status: wo.status,
    source: wo.source,
    band: wo.band,
    slaSystemName: wo.slaSystemName,
    assetTag: wo.assetTag,
    assetName: wo.assetName,
    areaName: wo.areaName,
    titleEl: wo.titleEl,
    calledAt: wo.calledAt,
    dueResponseAt: wo.dueResponseAt,
    dueRestoreAt: wo.dueRestoreAt,
    dueReportAt: wo.dueReportAt,
    dueDate: wo.dueDate,
    respondedAt: wo.respondedAt,
    restoredAt: wo.restoredAt,
    completedAt: wo.completedAt,
    escalatedAt: wo.escalatedAt,
    contractorName: wo.contractorName,
    sla: wo.sla,
  };
}

export function buildWorkOrderList(): { items: WorkOrderListRow[]; total: number } {
  const pm = buildPmWorkOrder();
  const items = [
    buildWorkOrderListRow(),
    buildWorkOrderListRow({
      id: "wo-3",
      ref: "NGH-WO-2026-0039",
      status: "OPEN",
      source: "TECHNICAL_SERVICES",
      slaSystemId: "sla-1",
      slaSystemName: "Σύστημα κλιματισμού χειρουργείων και ΜΕΘ",
      band: "CRITICAL",
      assetTag: "NGH-HVAC-0007",
      assetName: "ΚΚΜ χειρουργείου 2",
      titleEl: "Δεν ψύχει η κλιματιστική μονάδα του χειρουργείου 2",
      calledAt: "2026-10-05T10:00:00.000Z",
      respondedAt: null,
      escalatedAt: "2026-10-05T10:31:00.000Z",
      sla: { response: "RED", restore: "RED", report: "GREEN" },
    }),
    buildWorkOrderListRow({ ...pm }),
  ];
  return { items, total: items.length };
}

export function buildWorkOrderEvent(overrides: Partial<WorkOrderEvent> = {}): WorkOrderEvent {
  return {
    id: "ev-1",
    workOrderId: "wo-1",
    at: "2026-10-06T05:00:00.000Z",
    byId: "user-nursing",
    byName: "Ν. Νοσηλευτή",
    kind: "CREATED",
    noteEl: null,
    documentId: null,
    documentTitle: null,
    ...overrides,
  };
}

/** GET /work-orders/:id */
export function buildWorkOrderDetail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  const { events, checklistEl, repeatCount, ...rest } = overrides;
  return {
    ...buildWorkOrder(rest),
    events: events ?? [
      buildWorkOrderEvent(),
      buildWorkOrderEvent({ id: "ev-2", at: "2026-10-06T05:20:00.000Z", byId: "user-tech", byName: "Α. Τεχνικού", kind: "ACKNOWLEDGED" }),
      buildWorkOrderEvent({
        id: "ev-3",
        at: "2026-10-06T05:40:00.000Z",
        byId: "user-tech",
        byName: "Α. Τεχνικού",
        kind: "PHOTO",
        documentId: "doc-1",
        documentTitle: "Πίνακας ελέγχου ανελκυστήρα",
      }),
    ],
    checklistEl: checklistEl ?? null,
    repeatCount: repeatCount ?? 1,
  };
}

/** GET /backlog items */
export function buildBacklogItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: "bl-1",
    orgUnitId: UNIT,
    kind: "REPLACEMENT",
    titleEl: "Αντικατάσταση ανελκυστήρα Α3",
    descriptionEl: null,
    riskBand: "HIGH",
    costEstimate: 180_000,
    assetId: "asset-2",
    assetTag: "NGH-LIFT-0003",
    assetName: "Ανελκυστήρας Α3",
    slaSystemId: "sla-2",
    slaSystemName: "Ανελκυστήρες ασθενών",
    sourceWorkOrderId: "wo-1",
    sourceWorkOrderRef: "NGH-WO-2026-0042",
    autoDrafted: true,
    autoReason: "THREE_CORRECTIVE_IN_12_MONTHS",
    historyEl: "NGH-WO-2026-0011 · 12/02/2026\nNGH-WO-2026-0027 · 03/06/2026\nNGH-WO-2026-0042 · 06/10/2026",
    status: "OPEN",
    targetProjectId: null,
    targetProjectCode: null,
    raisedById: null,
    raisedByName: "Σύστημα",
    raisedAt: "2026-10-06T09:00:00.000Z",
    closedAt: null,
    createdAt: "2026-10-06T09:00:00.000Z",
    updatedAt: "2026-10-06T09:00:00.000Z",
    ...overrides,
  };
}

export function buildBacklogList(): { items: BacklogItem[]; total: number } {
  const items = [
    buildBacklogItem(),
    buildBacklogItem({
      id: "bl-2",
      kind: "REPAIR",
      titleEl: "Επισκευή στεγάνωσης δώματος νέας πτέρυγας",
      riskBand: "SIGNIFICANT",
      costEstimate: 42_500,
      assetId: null,
      assetTag: null,
      assetName: null,
      slaSystemId: null,
      slaSystemName: null,
      sourceWorkOrderId: null,
      sourceWorkOrderRef: null,
      autoDrafted: false,
      autoReason: null,
      historyEl: null,
      status: "FUNDED",
      targetProjectId: "p-77",
      targetProjectCode: "NGH-2026-031",
      raisedById: "user-estates",
      raisedByName: "Π. Προϊσταμένου",
    }),
  ];
  return { items, total: items.length };
}

export function buildBacklogSummary(): BacklogSummaryRow[] {
  return [
    { orgUnitId: UNIT, unitName: "Γ.Ν. Λευκωσίας", riskBand: "HIGH", count: 3, costEstimate: 390_000, fundedCost: 0, unfundedCost: 390_000 },
    { orgUnitId: UNIT, unitName: "Γ.Ν. Λευκωσίας", riskBand: "SIGNIFICANT", count: 2, costEstimate: 65_000, fundedCost: 42_500, unfundedCost: 22_500 },
    { orgUnitId: "larnaca-general", unitName: "Γ.Ν. Λάρνακας", riskBand: "MODERATE", count: 1, costEstimate: 12_000, fundedCost: 0, unfundedCost: 12_000 },
  ];
}

/** GET /maintenance/scorecard — rates missing, as the Nicosia seed is today. */
export function buildScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    maintenanceContractId: AGREEMENT,
    contractorName: "Δείγμα Η/Μ Συντήρηση Λτδ",
    contractRef: "Α.Ο 42/24",
    from: "2026-07-01",
    to: "2026-10-01",
    workOrders: { total: 120, corrective: 48, pm: 70, statutory: 2, open: 6 },
    response: { due: 48, onTime: 44, pct: 91.7 },
    restore: { due: 46, onTime: 40, pct: 87 },
    report: { due: 44, onTime: 41, pct: 93.2 },
    pm: { due: 72, onTime: 66, pct: 91.7 },
    availability: { criticalDowntimeHours: 14, otherDowntimeHours: 96, allowanceHours: 40, penaltyEur: 0 },
    penalties: { pmEur: 0, responseEur: 0, restoreEur: 0, availabilityEur: 0, totalEur: 0, capUsedPct: 0, ratesMissing: true },
    repeatFailures: 1,
    byBand: [
      { band: "CRITICAL", corrective: 12, responseOnTimePct: 100, restoreOnTimePct: 91.7, downtimeHours: 14 },
      { band: "P1", corrective: 20, responseOnTimePct: 90, restoreOnTimePct: 85, downtimeHours: 60 },
      { band: "P2", corrective: 16, responseOnTimePct: 87.5, restoreOnTimePct: 87.5, downtimeHours: 36 },
    ],
    ...overrides,
  };
}
