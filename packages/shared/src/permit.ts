import { z } from "zod";
import { AreaType, PatientRiskGroup } from "./area";
import type { AppRole } from "./auth";
import type { DateRules } from "./calendar-date";
import { SlaState } from "./site";

// ------------------------------------------------------------ M3 (R19–R25)
// CAPEX-01 §6: request → ICRA wizard → ILSM check → routing → clinical
// approval → active → closeout. Every rule below cites the brief line it
// comes from; anything the brief leaves open is marked ASSUMPTION and listed
// in docs/briefs/README.md Errata for the owner.

// ----------------------------------------------------------- systems, R19
export const PermitSystem = z.enum([
  "ELECTRICAL",
  "HVAC",
  "MEDICAL_GAS",
  "WATER",
  "FIRE",
  "IT",
  "STEAM",
  "DRAINAGE",
]);
export type PermitSystem = z.infer<typeof PermitSystem>;

// RULE (§6.1): pulling a riser feeds theatres two floors up. Until the asset
// register arrives (M4, `asset.serves_area_ids`), a `system_feed` row says
// which areas a system serves from a given source area, so the request can
// warn on indirect impact today and migrate to assets later. ASSUMPTION.
export const SystemFeed = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  system: PermitSystem,
  sourceAreaId: z.string().nullable(), // null = the whole unit (e.g. main LV board)
  servesAreaIds: z.array(z.string()),
  labelEl: z.string(),
});
export type SystemFeed = z.infer<typeof SystemFeed>;

export const AffectedArea = z.object({
  areaId: z.string(),
  code: z.string(),
  nameEl: z.string(),
  areaType: AreaType,
  patientRiskGroup: PatientRiskGroup,
  buildingCode: z.string(),
  floorCode: z.string(),
  // RULE (§6.1): DIRECT = the engineer picked it; INDIRECT = a system_feed
  // says it is downstream. Indirect areas count for routing and for the
  // ICRA risk group exactly like direct ones; the UI only labels them.
  impact: z.enum(["DIRECT", "INDIRECT"]),
  viaSystem: PermitSystem.nullable(),
});
export type AffectedArea = z.infer<typeof AffectedArea>;

// ------------------------------------------------------------- ICRA, R20
export const IcraActivityType = z.enum(["A", "B", "C", "D"]);
export type IcraActivityType = z.infer<typeof IcraActivityType>;

export const IcraClass = z.enum(["I", "II", "III", "IV", "V"]);
export type IcraClass = z.infer<typeof IcraClass>;

// One mandatory control, shown read-only on S12 and printed on S13.
export const IcraControl = z.object({
  id: z.string(), // stable within a matrix version, e.g. "IV-07"
  textEl: z.string(),
  textEn: z.string(),
  phase: z.enum(["DURING", "ON_COMPLETION"]),
});
export type IcraControl = z.infer<typeof IcraControl>;

export const IcraMatrixCell = z.object({
  activityType: IcraActivityType,
  riskGroup: PatientRiskGroup,
  icraClass: IcraClass,
  controls: z.array(IcraControl),
});
export type IcraMatrixCell = z.infer<typeof IcraMatrixCell>;

// RULE (§6.2, §2 ASHE row): the matrix is versioned reference data. ΟΚΥπΥ
// Infection Control approves the local edition and can amend it without a
// release: a new version row with an effective date, never an edit in place.
export const IcraMatrixVersion = z.object({
  id: z.string(), // e.g. "OKYPY-ICRA-2.0-2026.1"
  basedOn: z.string(), // "ASHE ICRA 2.0 (2022)"
  effectiveFrom: z.string(), // YYYY-MM-DD
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "RETIRED"]),
  notesEl: z.string().nullable(),
  cells: z.array(IcraMatrixCell), // 4 × 4 = 16 cells
});
export type IcraMatrixVersion = z.infer<typeof IcraMatrixVersion>;

// Surrounding-area assessment (§6.2): above, below, lateral, behind, in
// front. Each is an area or nothing; its risk group joins the "highest of
// all affected areas" rule.
export const SurroundingSide = z.enum(["ABOVE", "BELOW", "LATERAL", "BEHIND", "IN_FRONT"]);
export type SurroundingSide = z.infer<typeof SurroundingSide>;

export const SurroundingArea = z.object({
  side: SurroundingSide,
  areaId: z.string().nullable(),
  patientRiskGroup: PatientRiskGroup.nullable(),
  noteEl: z.string().nullable(),
});
export type SurroundingArea = z.infer<typeof SurroundingArea>;

// What the wizard sends and what the engine answers.
export const IcraInput = z.object({
  activityType: IcraActivityType,
  affectedAreaIds: z.array(z.string()).min(1),
  surrounding: z.array(SurroundingArea).max(5).default([]),
  // RULE (§6.2): Class II is invalid for construction or renovation; the
  // wizard must refuse it. The engine needs to know which kind of work this
  // is to apply that rule.
  workKind: z.enum(["CONSTRUCTION", "RENOVATION", "MAINTENANCE", "INSPECTION", "OTHER"]),
});
export type IcraInput = z.infer<typeof IcraInput>;

export const IcraResult = z.object({
  matrixVersionId: z.string(),
  activityType: IcraActivityType,
  // Highest of all affected + surrounding areas (§6.2).
  riskGroup: PatientRiskGroup,
  riskGroupFromAreaId: z.string(), // which area set it, so the UI can say why
  icraClass: IcraClass,
  controls: z.array(IcraControl),
  // RULE (§6.2): Class III and above generates a printable permit.
  permitRequired: z.boolean(),
  // RULE (§6.2): refused when the cell resolves to II for construction or
  // renovation. The engine then returns the cell and this key; the wizard
  // shows the sentence and disables Υποβολή.
  refusalKey: z.enum(["classTwoInvalidForWorks"]).nullable(),
});
export type IcraResult = z.infer<typeof IcraResult>;

// ------------------------------------------------------------- ILSM, R21
// RULE (§6.3): affecting fire detection, suppression, compartmentation,
// exits or evacuation routes makes ILSM mandatory.
export const IlsmTrigger = z.enum([
  "FIRE_DETECTION",
  "FIRE_SUPPRESSION",
  "COMPARTMENTATION",
  "EXITS",
  "EVACUATION_ROUTES",
]);
export type IlsmTrigger = z.infer<typeof IlsmTrigger>;

export const IlsmMeasure = z.enum([
  "INTERIM_MEASURES_LIST",
  "FIRE_WATCH",
  "EXTRA_DRILLS",
  "NOTIFY_FIRE_OFFICER",
  "TEMPORARY_DETECTION",
  "TEMPORARY_SIGNAGE",
  "ALTERNATIVE_EXIT_ROUTE",
]);
export type IlsmMeasure = z.infer<typeof IlsmMeasure>;

export const IlsmCheck = z.object({
  triggers: z.array(IlsmTrigger),
  required: z.boolean(), // triggers.length > 0
  measures: z.array(IlsmMeasure), // the four from §6.3 are always in when required
  fireOfficerNotifiedAt: z.string().nullable(),
});
export type IlsmCheck = z.infer<typeof IlsmCheck>;

// ---------------------------------------------------------- routing, R22
// CAPEX-01 §4 `permit_approval.role` plus WARD_MANAGER, which §6.4 names
// («ward/department manager for every clinical area touched») but §4 omits.
// ASSUMPTION, listed in the Errata.
export const ApprovalRole = z.enum([
  "INFECTION_CONTROL",
  "WARD_MANAGER",
  "NURSING",
  "TECHNICAL",
  "SAFETY",
  "HOSPITAL_DIRECTOR",
]);
export type ApprovalRole = z.infer<typeof ApprovalRole>;

// Why a line is on the route — shown in the inbox and on S13.
export const RoutingReason = z.enum([
  "classThreeOrAbove", // INFECTION_CONTROL, §6.4
  "clinicalAreaTouched", // WARD_MANAGER per clinical area, §6.4
  "inpatientAreaTouched", // NURSING, §6.4
  "always", // TECHNICAL, §6.4
  "ilsmRequired", // SAFETY, §6.3 (ASSUMPTION: the fire officer is the SAFETY approver)
  "durationAboveThreshold", // HOSPITAL_DIRECTOR, §6.4
  "classFive", // HOSPITAL_DIRECTOR, §6.4
]);
export type RoutingReason = z.infer<typeof RoutingReason>;

export const ApprovalDecision = z.enum(["PENDING", "APPROVED", "RETURNED", "REJECTED"]);
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;

export const PermitApproval = z.object({
  id: z.string(),
  permitId: z.string(),
  role: ApprovalRole,
  reason: RoutingReason,
  // For WARD_MANAGER: which area this line is for. Null for unit-wide roles.
  areaId: z.string().nullable(),
  areaNameEl: z.string().nullable(),
  // Who may decide: resolved from the approvers scoped to the area
  // (WARD_MANAGER, NURSING, INFECTION_CONTROL) or the unit (the rest). The
  // TECHNICAL and SAFETY appointments may be held by a technical approver or
  // an estates head as well as a clinical approver (ADR-0039).
  approverId: z.string().nullable(),
  approverName: z.string().nullable(),
  decision: ApprovalDecision,
  commentEl: z.string().nullable(),
  decidedAt: z.string().nullable(),
  // SLA for the decision (ASSUMPTION: 2 working days, like an RFI's default),
  // so S14 can show a SlaChip.
  dueAt: z.string(),
  slaState: SlaState, // same scale as an RFI (site.ts), so SlaChip needs nothing new
});
export type PermitApproval = z.infer<typeof PermitApproval>;

// ----------------------------------------------------- the permit, R19–R24
// CAPEX-01 §4 `shutdown_permit.status` plus BREACH: §6.5 says an overrun
// «flips it to breach», which is a state the calendar and the banner show.
export const PermitStatus = z.enum([
  "DRAFT",
  "SUBMITTED",
  "CLINICAL_REVIEW",
  "APPROVED",
  "ACTIVE",
  "BREACH",
  "CLOSED",
  "REJECTED",
]);
export type PermitStatus = z.infer<typeof PermitStatus>;

// RULE (§6.6): no closeout, no permit closure. Every box must be true and
// the clinical owner must have signed before CLOSED is allowed.
export const CloseoutChecklist = z.object({
  barriersRemoved: z.boolean().default(false),
  areaCleaned: z.boolean().default(false),
  airBalanceRestored: z.boolean().default(false),
  systemsTestedAndReturned: z.boolean().default(false),
  fireSystemsReenabled: z.boolean().default(false),
  noteEl: z.string().nullable().default(null),
  clinicalAcceptanceById: z.string().nullable().default(null),
  clinicalAcceptanceByName: z.string().nullable().default(null),
  clinicalAcceptanceAt: z.string().nullable().default(null),
});
export type CloseoutChecklist = z.infer<typeof CloseoutChecklist>;

// RULE (OWNER 26/11/2026, «παράδοση σε δύο βήματα»): the works side ticks the
// checklist and submits the area for acceptance; the clinical owner then
// accepts and closes, or returns it with a comment. There is no status for
// the wait between the two (statuses feed the calendar, the filters, the
// banners and the reports): the permit stays ACTIVE or BREACH, and these
// fields say a handback is waiting.
export const PermitHandback = z.object({
  // Set while a handback waits for acceptance; cleared by a return.
  submittedAt: z.string().nullable(),
  // Who submitted it last. A return keeps them: it is who it goes back to.
  submittedById: z.string().nullable(),
  submittedByName: z.string().nullable(),
  // The last return, kept on the record (every earlier one is in the audit
  // trail): who, when and why.
  returnedAt: z.string().nullable(),
  returnedById: z.string().nullable(),
  returnedByName: z.string().nullable(),
  returnCommentEl: z.string().nullable(),
  // Worked out for the caller by the API: they hold the acceptance capacity
  // over this permit (§6.6) and are not the person who submitted it.
  mayAccept: z.boolean(),
});
export type PermitHandback = z.infer<typeof PermitHandback>;

export const ShutdownPermit = z.object({
  id: z.string(),
  // RULE (ADR-0019 style): a reference eCapital owns, `PTW-<UNITCODE>-<YYYY>-<NNN>`,
  // allocated on submit, not on draft. ASSUMPTION on the prefix.
  ref: z.string().nullable(),
  orgUnitId: z.string(),
  projectId: z.string().nullable(),
  contractId: z.string().nullable(),
  titleEl: z.string(),
  descriptionEl: z.string(),
  workKind: IcraInput.shape.workKind,
  systems: z.array(PermitSystem).min(1),
  // RULE (S11 autosave, reconciled with the web agent 19/09/2026): the draft
  // is created the moment the requester leaves step 1, which is before any
  // area has been picked, so a DRAFT can legitimately carry none. The list is
  // never empty from SUBMITTED on — the API refuses the transition — and the
  // `.min(1)` that used to say so here said it about the wrong moment.
  affectedAreas: z.array(AffectedArea),
  plannedStart: z.string(), // ISO datetime, Europe/Nicosia on screen
  plannedEnd: z.string(),
  actualStart: z.string().nullable(),
  actualEnd: z.string().nullable(),
  icra: IcraResult.nullable(), // null until the wizard ran
  surrounding: z.array(SurroundingArea),
  ilsm: IlsmCheck.nullable(),
  contingencyPlanEl: z.string().nullable(),
  status: PermitStatus,
  approvals: z.array(PermitApproval),
  closeout: CloseoutChecklist.nullable(),
  handback: PermitHandback,
  requestedById: z.string(),
  requestedByName: z.string(),
  requestedAt: z.string(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  closedById: z.string().nullable(),
  closedAt: z.string().nullable(),
  // RULE (§6.5): overrun = now > plannedEnd while ACTIVE. Set by the API.
  breachedAt: z.string().nullable(),
  // RULE (§6.7): clashes found at submission, never blocking.
  clashes: z.array(
    z.object({
      kind: z.enum(["REDUNDANT_HALVES", "TWO_THEATRES", "SAME_AREA_OVERLAP"]),
      otherPermitId: z.string(),
      otherPermitRef: z.string().nullable(),
      // `permitClash.<KIND>`, rendered with `{ ref }` — the other permit's
      // reference. Both catalogues carry the three keys.
      messageKey: z.string(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ShutdownPermit = z.infer<typeof ShutdownPermit>;

// Writes. S11 saves a draft per step; submit is a separate transition.
export const ShutdownPermitDraft = z.object({
  projectId: z.string().nullable().default(null),
  contractId: z.string().nullable().default(null),
  titleEl: z.string().min(3).max(200),
  descriptionEl: z.string().max(4000).default(""),
  workKind: IcraInput.shape.workKind,
  systems: z.array(PermitSystem).min(1),
  // Step 2 and step 3 of the wizard, which the create call has not reached
  // yet. Absent means «not answered»; the API keeps a provisional window on
  // the record until step 3 gives it a real one, and refuses SUBMITTED until
  // both are answered (ADR-0026).
  affectedAreaIds: z.array(z.string()).default([]),
  plannedStart: z.string().optional(),
  plannedEnd: z.string().optional(),
  contingencyPlanEl: z.string().max(4000).nullable().default(null),
  ilsmTriggers: z.array(IlsmTrigger).default([]),
});
export type ShutdownPermitDraft = z.infer<typeof ShutdownPermitDraft>;

// Date sanity (`calendar-date.ts`). The window is planned, so the future is its
// whole point; only its end cannot come before its start. The API has said
// so since M3 (errors.permitWindowBackwards, and the database refuses an
// empty window as well); the wizard now says it under the field.
export const PERMIT_DATE_RULES = {
  ordered: [["plannedStart", "plannedEnd"]],
} as const satisfies DateRules<keyof ShutdownPermitDraft & string>;

// S12 step 4: the requester acknowledged every control (RULE in UI §5 S12).
export const IcraSubmission = z.object({
  activityType: IcraActivityType,
  surrounding: z.array(SurroundingArea).max(5).default([]),
  acknowledgedControlIds: z.array(z.string()),
});
export type IcraSubmission = z.infer<typeof IcraSubmission>;

export const PermitTransition = z.object({
  to: z.enum(["SUBMITTED", "ACTIVE", "CLOSED", "REJECTED"]),
  commentEl: z.string().max(2000).nullable().default(null),
  // Not read for CLOSED any more (OWNER 26/11/2026): CLOSED is the clinical
  // owner accepting the handback the works side submitted, and the checklist
  // is the one stored with that submission. Kept so an older client's body
  // still parses; the signature is never taken from it.
  closeout: CloseoutChecklist.optional(),
});
export type PermitTransition = z.infer<typeof PermitTransition>;

// Step 1 of the handback: the works side's checklist, every box ticked.
export const PermitCloseoutSubmit = z.object({
  closeout: CloseoutChecklist,
});
export type PermitCloseoutSubmit = z.infer<typeof PermitCloseoutSubmit>;

// Step 2, the other answer: the clinical owner returns the handback.
export const PermitHandbackReturn = z.object({
  commentEl: z.string().max(2000),
});
export type PermitHandbackReturn = z.infer<typeof PermitHandbackReturn>;

export const ApprovalDecisionWrite = z.object({
  decision: z.enum(["APPROVED", "RETURNED", "REJECTED"]),
  commentEl: z.string().max(2000).nullable().default(null),
});
export type ApprovalDecisionWrite = z.infer<typeof ApprovalDecisionWrite>;

export const PermitListQuery = z.object({
  orgUnitId: z.string().optional(),
  status: z.array(PermitStatus).optional(),
  system: PermitSystem.optional(),
  areaType: AreaType.optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type PermitListQuery = z.infer<typeof PermitListQuery>;

// ASSUMPTION (item 9, S03 "Ανοικτές άδειες" card): `projectId` added to the
// row so that card can filter without fetching every permit's full detail.
// The original list of picked fields did not carry it; flagged for the PM to
// confirm with the API agent at merge.
export const PermitListRow = ShutdownPermit.pick({
  id: true,
  ref: true,
  orgUnitId: true,
  projectId: true,
  titleEl: true,
  systems: true,
  plannedStart: true,
  plannedEnd: true,
  status: true,
  breachedAt: true,
}).extend({
  icraClass: IcraClass.nullable(),
  areaCount: z.number().int(),
  highestRiskGroup: PatientRiskGroup.nullable(),
  pendingApprovals: z.number().int(),
  orgUnitNameEl: z.string(),
});
export type PermitListRow = z.infer<typeof PermitListRow>;

// ------------------------------------------------ disruption calendar, R25
export const CalendarEntry = z.object({
  permitId: z.string(),
  permitRef: z.string().nullable(),
  orgUnitId: z.string(),
  orgUnitCode: z.string(),
  titleEl: z.string(),
  systems: z.array(PermitSystem),
  areaIds: z.array(z.string()),
  areaTypes: z.array(AreaType),
  areaNamesEl: z.array(z.string()),
  start: z.string(),
  end: z.string(),
  icraClass: IcraClass.nullable(),
  status: PermitStatus,
  hasClash: z.boolean(),
});
export type CalendarEntry = z.infer<typeof CalendarEntry>;

export const CalendarQuery = z.object({
  from: z.string(), // YYYY-MM-DD
  to: z.string(),
  orgUnitId: z.string().optional(),
  areaType: AreaType.optional(),
  system: PermitSystem.optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuery>;

// CAPEX-01 §11: theatre and ICU hours lost to planned works, by hospital and month.
export const DisruptionHoursRow = z.object({
  orgUnitId: z.string(),
  orgUnitNameEl: z.string(),
  month: z.string(), // YYYY-MM
  theatreHours: z.number(),
  icuHours: z.number(),
  permits: z.number().int(),
});
export type DisruptionHoursRow = z.infer<typeof DisruptionHoursRow>;

// -------------------------------------------------- approvals inbox, S14
export const InboxItemType = z.enum(["SHUTDOWN", "VARIATION", "PAYMENT_CERT", "OTHER"]);
export type InboxItemType = z.infer<typeof InboxItemType>;

export const InboxItem = z.object({
  id: z.string(), // the approval line id (permit) or the entity id (others)
  type: InboxItemType,
  whatEl: z.string(),
  whereEl: z.string(), // «Μονάδα › Χώρος»
  requestedByName: z.string(),
  requestedAt: z.string(),
  dueAt: z.string().nullable(),
  slaState: SlaState.nullable(),
  unread: z.boolean(),
  // RULE (UI §5 S14, DecisionPanel): exactly three facts.
  facts: z.array(z.object({ label: z.string(), value: z.string() })).length(3),
  href: z.string(), // the full record, for «Άνοιγμα»
  // What the panel's buttons do: permit approval lines take a decision here;
  // variations and certificates link out to their own screens for now.
  decidable: z.boolean(),
  // OWNER UAT 25/11/2026: one sentence, in the caller's language, that says
  // why this item is here or why it cannot be decided from the panel — a
  // permit returned to its requester, a line with nobody appointed to it, a
  // line the caller's role may not decide. The panel shows it; null when the
  // three facts already say everything.
  note: z.string().nullable().default(null),
});
export type InboxItem = z.infer<typeof InboxItem>;

export const Inbox = z.object({
  items: z.array(InboxItem),
  counts: z.record(InboxItemType, z.number().int()),
});
export type Inbox = z.infer<typeof Inbox>;

// ------------------------------------------------ approver scopes, item 8
// CAPEX-01 §6.4: routing derives from the affected areas. Admin assigns each
// `clinical_approver` the area roles (WARD_MANAGER, NURSING, INFECTION_CONTROL
// — the three `ApprovalRole` values that are per-area, §6.4) and the unit
// roles (TECHNICAL, SAFETY, HOSPITAL_DIRECTOR, INFECTION_CONTROL, NURSING —
// the roles §6.4 resolves at the unit rather than the area) that person may
// decide for. ASSUMPTION (flagged for the PM to reconcile at merge, per the
// task's own instruction): `GET/PUT /admin/users/:id/approver-scopes`, body
// `{ areas: [{areaId, role}], units: [{orgUnitId, role}] }` — not yet in
// CAPEX-01's endpoint list.
export const AreaApprovalRole = z.enum(["WARD_MANAGER", "NURSING", "INFECTION_CONTROL"]);
export type AreaApprovalRole = z.infer<typeof AreaApprovalRole>;

export const UnitApprovalRole = z.enum([
  "TECHNICAL",
  "SAFETY",
  "HOSPITAL_DIRECTOR",
  "INFECTION_CONTROL",
  "NURSING",
]);
export type UnitApprovalRole = z.infer<typeof UnitApprovalRole>;

export const ApproverAreaScope = z.object({ areaId: z.string(), role: AreaApprovalRole });
export type ApproverAreaScope = z.infer<typeof ApproverAreaScope>;

export const ApproverUnitScope = z.object({ orgUnitId: z.string(), role: UnitApprovalRole });
export type ApproverUnitScope = z.infer<typeof ApproverUnitScope>;

export const ApproverScopes = z.object({
  areas: z.array(ApproverAreaScope),
  units: z.array(ApproverUnitScope),
});
export type ApproverScopes = z.infer<typeof ApproverScopes>;

// --------------------------------------- who may hold which scope, ADR-0039
// Owner decision 26/11/2026: the TECHNICAL and SAFETY lines get their own
// role, so the estate's people decide them without clinical approval rights.
// Both ends read these two lists: the API refuses a scope the account's roles
// do not allow (422), and S24's editor offers only the scopes they allow.

/** The unit scopes that are the estate's, not the ward's. */
export const TECHNICAL_UNIT_APPROVAL_ROLES: readonly UnitApprovalRole[] = ["TECHNICAL", "SAFETY"];

/**
 * The account roles that may hold a TECHNICAL or SAFETY unit scope. The
 * clinical approver stays on the list so the appointments made before the
 * new role existed keep working; the estates head is the seeded TECHNICAL
 * approver (ADR-0026).
 */
export const TECHNICAL_SCOPE_HOLDERS: readonly AppRole[] = [
  "technical_approver",
  "clinical_approver",
  "estates_head",
];

/** Every other scope, by area or by unit, is a clinical approver's alone. */
export const CLINICAL_SCOPE_HOLDERS: readonly AppRole[] = ["clinical_approver"];

function holdsAny(roles: readonly AppRole[], holders: readonly AppRole[]): boolean {
  return roles.some((role) => holders.includes(role));
}

export function isTechnicalUnitApprovalRole(role: UnitApprovalRole): boolean {
  return TECHNICAL_UNIT_APPROVAL_ROLES.includes(role);
}

/** The scopes an account with these roles may be given; empty lists for none. */
export function allowedApproverScopeRoles(roles: readonly AppRole[]): {
  areas: AreaApprovalRole[];
  units: UnitApprovalRole[];
} {
  const clinical = holdsAny(roles, CLINICAL_SCOPE_HOLDERS);
  const technical = holdsAny(roles, TECHNICAL_SCOPE_HOLDERS);
  return {
    areas: clinical ? [...AreaApprovalRole.options] : [],
    units: UnitApprovalRole.options.filter((role) =>
      isTechnicalUnitApprovalRole(role) ? technical : clinical,
    ),
  };
}

/** True when the account can be given any scope at all — what S24 shows the editor for. */
export function mayHoldApproverScopes(roles: readonly AppRole[]): boolean {
  const allowed = allowedApproverScopeRoles(roles);
  return allowed.areas.length > 0 || allowed.units.length > 0;
}

/**
 * Why a replacement may not be saved on an account with these roles, as the
 * API error key, or null when every scope in it is allowed. The clinical
 * refusal is checked first: it is the older sentence and the wider rule.
 */
export function approverScopesRefusal(
  roles: readonly AppRole[],
  scopes: ApproverScopes,
): "errors.approverScopesNeedRole" | "errors.approverScopesNeedTechnicalRole" | null {
  const wantsClinical =
    scopes.areas.length > 0 || scopes.units.some((scope) => !isTechnicalUnitApprovalRole(scope.role));
  const wantsTechnical = scopes.units.some((scope) => isTechnicalUnitApprovalRole(scope.role));
  if (wantsClinical && !holdsAny(roles, CLINICAL_SCOPE_HOLDERS)) return "errors.approverScopesNeedRole";
  if (wantsTechnical && !holdsAny(roles, TECHNICAL_SCOPE_HOLDERS)) {
    return "errors.approverScopesNeedTechnicalRole";
  }
  return null;
}
