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

import {
  bigint,
  boolean,
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
