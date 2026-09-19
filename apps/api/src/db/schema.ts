// eCapital M0 schema, as Drizzle sees it.
//
// NO PATIENT DATA — CAPEX-01 §12 says no patient data enters this system and
// the schema must make that impossible by design. Every column below is
// either a building fact, an organisational fact, a staff name and work
// email, or an audit fact. There is no place to put a patient name, an
// identifier, a diagnosis, an episode or an appointment, and a pull request
// that adds one is rejected on that ground alone. `area.beds` counts beds in
// a room; `area.patientRiskGroup` is the ICRA Table 2 band of the room.
//
// All timestamps are `timestamptz` and stored UTC (CAPEX-01 §12); the web app
// displays them in Europe/Nicosia.
//
// ADR-0008: the migrations in ./migrations are the source of truth. This file
// is the typed view the query builder uses. Row-level security, grants and
// the audit trigger live only in the SQL, because Drizzle cannot express them.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const ecapital = pgSchema("ecapital");

export const orgUnitType = ecapital.enum("org_unit_type", ["HOSPITAL", "SERVICE"]);
export const directorate = ecapital.enum("directorate", [
  "LEMESOU_PAFOU",
  "LEFKOSIAS",
  "LARNAKAS_AMMOCHOSTOU",
  "DYPSY",
  "PFY",
  "AMBULANCE",
]);
export const areaType = ecapital.enum("area_type", [
  "THEATRE",
  "ICU",
  "WARD",
  "OPD",
  "LAB",
  "PLANT",
  "OFFICE",
  "OTHER",
]);
export const patientRiskGroup = ecapital.enum("patient_risk_group", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "HIGHEST",
]);
export const appRole = ecapital.enum("app_role", [
  "admin",
  "estates_head",
  "project_engineer",
  "technician",
  "finance",
  "clinical_approver",
  "executive_readonly",
  "auditor_readonly",
]);
export const auditAction = ecapital.enum("audit_action", ["INSERT", "UPDATE", "DELETE"]);

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const orgUnit = ecapital.table("org_unit", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  nameEl: text("name_el").notNull(),
  nameEn: text("name_en").notNull(),
  type: orgUnitType("type").notNull(),
  directorate: directorate("directorate").notNull(),
  costCentre: text("cost_centre"),
  timezone: text("timezone").notNull().default("Europe/Nicosia"),
  createdAt,
  updatedAt,
});

export const orgUnitAlias = ecapital.table(
  "org_unit_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    alias: text("alias").notNull().unique(),
    createdAt,
  },
  (t) => [index("org_unit_alias_unit_idx").on(t.orgUnitId)],
);

export const building = ecapital.table(
  "building",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    code: text("code").notNull(),
    nameEl: text("name_el").notNull(),
    grossAreaM2: numeric("gross_area_m2", { precision: 12, scale: 2 }),
    yearBuilt: integer("year_built"),
    storeys: integer("storeys"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("building_unit_code_key").on(t.orgUnitId, t.code),
    index("building_unit_idx").on(t.orgUnitId),
  ],
);

// floor and area keep a copy of org_unit_id so the RLS policy is a column
// comparison instead of a join up the tree. A database trigger fills it from
// the parent on insert and on any re-parenting, so the copy cannot drift.
export const floor = ecapital.table(
  "floor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    buildingId: uuid("building_id")
      .notNull()
      .references(() => building.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    code: text("code").notNull(),
    nameEl: text("name_el").notNull(),
    level: integer("level"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("floor_building_code_key").on(t.buildingId, t.code),
    index("floor_building_idx").on(t.buildingId),
    index("floor_unit_idx").on(t.orgUnitId),
  ],
);

export const area = ecapital.table(
  "area",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    floorId: uuid("floor_id")
      .notNull()
      .references(() => floor.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    code: text("code").notNull(),
    nameEl: text("name_el").notNull(),
    areaType: areaType("area_type").notNull(),
    patientRiskGroup: patientRiskGroup("patient_risk_group").notNull(),
    costCentre: text("cost_centre"),
    beds: integer("beds"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("area_floor_code_key").on(t.floorId, t.code),
    index("area_floor_idx").on(t.floorId),
    index("area_unit_idx").on(t.orgUnitId),
  ],
);

// Staff only: a name and a work email, nothing else.
export const appUser = ecapital.table("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt,
  updatedAt,
});

export const appUserOrgUnit = ecapital.table(
  "app_user_org_unit",
  {
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.appUserId, t.orgUnitId] })],
);

export const appUserRole = ecapital.table(
  "app_user_role",
  {
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    role: appRole("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.appUserId, t.role] })],
);

// Entra group → role, with an optional unit. Configuration, not code
// (ADR-0009): adding a hospital's clinical approver group is a row.
export const roleMapping = ecapital.table("role_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  entraGroupId: text("entra_group_id").notNull(),
  role: appRole("role").notNull(),
  orgUnitId: text("org_unit_id").references(() => orgUnit.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt,
  updatedAt,
});

// R42. Append-only by grant and by trigger; see the migration.
export const auditLog = ecapital.table(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    actorId: text("actor_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    action: auditAction("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    ip: inet("ip"),
    orgUnitId: text("org_unit_id"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_actor_idx").on(t.actorId),
  ],
);

export const schemaMigration = ecapital.table("schema_migration", {
  id: text("id").primaryKey(),
  checksum: text("checksum").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

// ------------------------------------------------------------------- M1 --
// The project register (R04–R07). Same rule as above: the SQL in
// ./migrations/0002_m1_projects.sql is the source of truth; policies, the
// code-allocation function and the audit triggers live only there.

export const projectCategory = ecapital.enum("project_category", [
  "NEW_BUILD",
  "RENOVATION",
  "SMALL_WORKS",
  "EQUIPMENT",
  "MAINTENANCE_CAPITAL",
  "IT",
]);

// The order is the rule (R04): a phase may move exactly one step along this
// list. PROJECT_PHASES below is the same list as plain data for the service.
export const projectPhase = ecapital.enum("project_phase", [
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

export const fundingSource = ecapital.enum("funding_source", [
  "STATE_BUDGET",
  "EU",
  "DONATION",
  "OWN",
]);
export const rag = ecapital.enum("rag", ["GREEN", "AMBER", "RED"]);
export const riskStatus = ecapital.enum("risk_status", ["OPEN", "MITIGATED", "CLOSED"]);
export const issueStatus = ecapital.enum("issue_status", ["OPEN", "RESOLVED"]);

export const project = ecapital.table(
  "project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    titleEl: text("title_el").notNull(),
    titleEn: text("title_en"),
    noteEl: text("note_el"),
    category: projectCategory("category").notNull(),
    phase: projectPhase("phase").notNull().default("IDEA"),
    phaseReasonEl: text("phase_reason_el"),
    phaseChangedAt: timestamp("phase_changed_at", { withTimezone: true }),
    approvedBudget: numeric("approved_budget", { precision: 14, scale: 2 }).notNull(),
    fundingSource: fundingSource("funding_source").notNull(),
    plannedStart: date("planned_start"),
    plannedFinish: date("planned_finish"),
    forecastStart: date("forecast_start"),
    forecastFinish: date("forecast_finish"),
    actualStart: date("actual_start"),
    actualFinish: date("actual_finish"),
    budgetYearFrom: integer("budget_year_from"),
    budgetYearTo: integer("budget_year_to"),
    rag: rag("rag").notNull().default("GREEN"),
    ragReason: text("rag_reason").notNull().default(""),
    sapWbs: text("sap_wbs"),
    tenderReference: text("tender_reference"),
    budgetArticle: text("budget_article"),
    commitmentFlag: boolean("commitment_flag").notNull().default(false),
    commitmentNote: text("commitment_note"),
    actionPlanRef: text("action_plan_ref"),
    inBudget2026: boolean("in_budget_2026").notNull().default(false),
    contractualCommitment: boolean("contractual_commitment").notNull().default(false),
    internalAuditFile: boolean("internal_audit_file").notNull().default(false),
    sourceRowRef: text("source_row_ref"),
    sponsorId: uuid("sponsor_id").references(() => appUser.id, { onDelete: "set null" }),
    projectManagerId: uuid("project_manager_id").references(() => appUser.id, {
      onDelete: "set null",
    }),
    createdAt,
    updatedAt,
    // Generated in the database from code and title_el; never written from here.
    searchNorm: text("search_norm"),
  },
  (t) => [
    index("project_unit_idx").on(t.orgUnitId),
    index("project_phase_idx").on(t.phase),
    index("project_rag_idx").on(t.rag),
    index("project_updated_idx").on(t.updatedAt),
  ],
);

export const milestone = ecapital.table(
  "milestone",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    titleEl: text("title_el").notNull(),
    baselineDate: date("baseline_date").notNull(),
    forecastDate: date("forecast_date"),
    actualDate: date("actual_date"),
    isGate: boolean("is_gate").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (t) => [
    index("milestone_project_idx").on(t.projectId, t.sortOrder),
    index("milestone_unit_idx").on(t.orgUnitId),
  ],
);

export const risk = ecapital.table(
  "risk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    descriptionEl: text("description_el").notNull(),
    likelihood: integer("likelihood").notNull(),
    impact: integer("impact").notNull(),
    ownerId: uuid("owner_id").references(() => appUser.id, { onDelete: "set null" }),
    mitigationEl: text("mitigation_el"),
    status: riskStatus("status").notNull().default("OPEN"),
    createdAt,
    updatedAt,
  },
  (t) => [index("risk_project_idx").on(t.projectId), index("risk_unit_idx").on(t.orgUnitId)],
);

export const issue = ecapital.table(
  "issue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    descriptionEl: text("description_el").notNull(),
    raisedBy: uuid("raised_by")
      .notNull()
      .references(() => appUser.id),
    dueDate: date("due_date"),
    status: issueStatus("status").notNull().default("OPEN"),
    createdAt,
    updatedAt,
  },
  (t) => [index("issue_project_idx").on(t.projectId), index("issue_unit_idx").on(t.orgUnitId)],
);

// Machinery behind ADR-0014. Row-level security is on and there is no policy,
// so nothing reaches it except ecapital.allocate_project_code.
export const projectCodeSeq = ecapital.table(
  "project_code_seq",
  {
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    nextSeq: integer("next_seq").notNull().default(1),
    updatedAt,
  },
  (t) => [primaryKey({ columns: [t.orgUnitId, t.year] })],
);

// ------------------------------------------------------------------- M1 --
// The contract register (R08, R10, R13). Same rule as above: the SQL in
// ./migrations/0003_m1_contracts.sql is the source of truth; the policies,
// the commitment trigger, the variation-number function and the segregation
// CHECK live only there.

export const contractorCategory = ecapital.enum("contractor_category", [
  "BUILDING",
  "MECHANICAL",
  "ELECTRICAL",
  "BIOMEDICAL",
  "IT",
  "CONSULTANT",
  "OTHER",
]);

export const contractType = ecapital.enum("contract_type", [
  "LUMP_SUM",
  "BOQ",
  "FRAMEWORK",
  "MEASURE_TERM",
  "SUPPLY",
  "SERVICE",
]);

export const variationReason = ecapital.enum("variation_reason", [
  "CLIENT_CHANGE",
  "SITE_CONDITION",
  "DESIGN_ERROR",
  "STATUTORY",
  "OTHER",
]);

// Only APPROVED counts towards a contract's current value.
export const variationStatus = ecapital.enum("variation_status", [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "RETURNED",
  "REJECTED",
]);

// No org_unit_id: a contractor works for the whole organisation and the same
// company holds contracts at more than one hospital.
export const contractor = ecapital.table(
  "contractor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    vatNumber: text("vat_number"),
    registrationNo: text("registration_no"),
    category: contractorCategory("category").notNull().default("OTHER"),
    sapVendorId: text("sap_vendor_id"),
    blacklisted: boolean("blacklisted").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (t) => [index("contractor_category_idx").on(t.category)],
);

export const contract = ecapital.table(
  "contract",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => project.id),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractor.id),
    contractNo: text("contract_no").notNull(),
    type: contractType("type").notNull(),
    awardDate: date("award_date").notNull(),
    awardDecisionDocId: text("award_decision_doc_id"),
    originalValue: numeric("original_value", { precision: 14, scale: 2 }).notNull(),
    // Derived in the database from the original value and the approved
    // variations (CAPEX-01 §7). Never written from here.
    currentValue: numeric("current_value", { precision: 14, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    startDate: date("start_date"),
    completionDate: date("completion_date"),
    extensionDays: integer("extension_days").notNull().default(0),
    retentionPct: numeric("retention_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    performanceBondValue: numeric("performance_bond_value", { precision: 14, scale: 2 }),
    bondExpiry: date("bond_expiry"),
    liquidatedDamagesPerDay: numeric("liquidated_damages_per_day", { precision: 14, scale: 2 }),
    defectsLiabilityMonths: integer("defects_liability_months").notNull().default(0),
    sapPoNumber: text("sap_po_number"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("contract_unit_no_key").on(t.orgUnitId, t.contractNo),
    index("contract_project_idx").on(t.projectId),
    index("contract_unit_idx").on(t.orgUnitId),
    index("contract_contractor_idx").on(t.contractorId),
  ],
);

export const boqItem = ecapital.table(
  "boq_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contract.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    itemNo: text("item_no").notNull(),
    descriptionEl: text("description_el").notNull(),
    unit: text("unit").notNull(),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    rate: numeric("rate", { precision: 14, scale: 2 }).notNull(),
    // Generated in the database as qty × rate; never written from here.
    amount: numeric("amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round(qty * rate, 2)`,
    ),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("boq_item_contract_no_key").on(t.contractId, t.itemNo),
    index("boq_item_contract_idx").on(t.contractId),
    index("boq_item_unit_idx").on(t.orgUnitId),
  ],
);

export const variation = ecapital.table(
  "variation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contract.id, { onDelete: "cascade" }),
    orgUnitId: text("org_unit_id")
      .notNull()
      .references(() => orgUnit.id),
    // Allocated by ecapital.allocate_variation_number, never typed.
    number: integer("number").notNull(),
    descriptionEl: text("description_el").notNull(),
    reason: variationReason("reason").notNull(),
    value: numeric("value", { precision: 14, scale: 2 }).notNull(),
    timeImpactDays: integer("time_impact_days").notNull().default(0),
    status: variationStatus("status").notNull().default("DRAFT"),
    raisedBy: uuid("raised_by")
      .notNull()
      .references(() => appUser.id),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull().defaultNow(),
    // R10: the CHECK in the migration refuses a row where this equals
    // raised_by, whoever is asking and whichever code path asks.
    decidedBy: uuid("decided_by").references(() => appUser.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionCommentEl: text("decision_comment_el"),
    createdAt,
    updatedAt,
  },
  (t) => [
    uniqueIndex("variation_contract_number_key").on(t.contractId, t.number),
    index("variation_contract_idx").on(t.contractId),
    index("variation_unit_idx").on(t.orgUnitId),
    index("variation_status_idx").on(t.status),
  ],
);
