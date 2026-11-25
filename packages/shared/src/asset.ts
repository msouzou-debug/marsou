import { z } from "zod";
import { PermitSystem } from "./permit";

// ------------------------------------------------------------ M4 (R26–R30, R45)
// CAPEX-01 §4 `asset`, `asset_document`, `asset_reading`; §8 QR labels; §2
// (Kahua row: the asset, not the project, is the permanent record).
//
// Owner steer, 20/09/2026: the system starts on a simple capital-and-
// maintenance basis and expands later. So this register is the backbone
// only: identity, place, class, criticality, condition, warranty, what
// project and contract it came from, what it cost, when it is due for
// replacement, its papers (as eArchive protocol numbers) and a QR label.
// No depreciation model, no spares, no meters beyond a plain reading row.

export const AssetClass = z.enum([
  "BUILDING_FABRIC",
  "HVAC",
  "ELECTRICAL",
  "MEDICAL_GAS",
  "WATER",
  "FIRE",
  "LIFT",
  "BIOMEDICAL", // R45: same register as building assets
  "IT",
  "OTHER",
]);
export type AssetClass = z.infer<typeof AssetClass>;

// Owner decision 25/11/2026: one register for every SAP fixed-asset class,
// no second tool. SAP's class is a six-digit code from a reference table
// (`ecapital.sap_asset_class`, migration 0030) that every signed-in user can
// read; an asset points at one, or at none.
export const SapAssetClassCode = z.string().regex(/^\d{6}$/);

export const SapAssetClass = z.object({
  code: SapAssetClassCode,
  nameEl: z.string(),
  nameEn: z.string(),
  active: z.boolean(),
});
export type SapAssetClass = z.infer<typeof SapAssetClass>;

/**
 * RULE (owner decision 25/11/2026): the SAP class an eCapital class starts
 * from. It prefills the asset form and backfilled the register in migration
 * 0030 (`ecapital.default_sap_asset_class`, the same table in SQL); the user
 * can always choose another. OTHER has no default: nobody can guess it.
 */
export const SAP_ASSET_CLASS_BY_ASSET_CLASS: Record<AssetClass, string | null> = {
  BUILDING_FABRIC: "111020",
  HVAC: "111042",
  ELECTRICAL: "111062",
  MEDICAL_GAS: "111062",
  WATER: "111062",
  FIRE: "111058",
  LIFT: "111040",
  BIOMEDICAL: "111030",
  IT: "111050",
  OTHER: null,
};

export function defaultSapAssetClass(assetClass: AssetClass): string | null {
  return SAP_ASSET_CLASS_BY_ASSET_CLASS[assetClass] ?? null;
}

// RULE (§2 Maximo row): criticality 1–5 per asset; PM frequency and SLA
// response time derive from it in M5. 1 = life-critical, 5 = cosmetic.
export const Criticality = z.number().int().min(1).max(5);

// RULE (§2 ERIC row): condition A–E, A = as new, E = life expired.
export const Condition = z.enum(["A", "B", "C", "D", "E"]);
export type Condition = z.infer<typeof Condition>;

export const AssetStatus = z.enum(["IN_SERVICE", "OUT_OF_SERVICE", "DISPOSED", "PLANNED"]);
export type AssetStatus = z.infer<typeof AssetStatus>;

export const Asset = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  areaId: z.string().nullable(), // null = whole building / external plant
  // RULE: the tag is the label text and the QR payload's key,
  // `<UNITCODE>-<CLASS>-<NNNN>`, allocated by the API, immutable (ADR-0014 pattern).
  tag: z.string(),
  nameEl: z.string(),
  assetClass: AssetClass,
  manufacturer: z.string().nullable(),
  model: z.string().nullable(),
  serialNo: z.string().nullable(),
  installedDate: z.string().nullable(),
  commissionedDate: z.string().nullable(),
  // R27: linked to source project, contract and capital cost.
  sourceProjectId: z.string().nullable(),
  sourceContractId: z.string().nullable(),
  capitalCost: z.number().nullable(),
  warrantyEnd: z.string().nullable(),
  // R30, lean: expected life and a replacement year and estimate the
  // engineer sets. The forecast is a sum over these, nothing more.
  expectedLifeYears: z.number().int().nullable(),
  replacementYear: z.number().int().nullable(),
  replacementCostEst: z.number().nullable(),
  criticality: Criticality,
  condition: Condition.nullable(),
  conditionAssessedAt: z.string().nullable(),
  parentAssetId: z.string().nullable(), // hierarchy: AHU → fan, chiller → pump
  // RULE (CAPEX-01 §6.1): which areas this asset serves. When set, permits
  // use it for indirect impact instead of `system_feed`.
  servesAreaIds: z.array(z.string()),
  system: PermitSystem.nullable(), // what a shutdown of it interrupts
  costCentre: z.string().nullable(),
  sapAssetNo: z.string().nullable(),
  // SAP's fixed-asset class code, «111042» (owner decision 25/11/2026).
  sapAssetClass: SapAssetClassCode.nullable(),
  status: AssetStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

// UAT 25/11/2026: the limits below were the database's CHECKs alone (0017),
// so a one-letter name or a 0-year life came back as one blanket «details
// are incomplete». The contract now carries them, so the API names the
// field before the insert. Dates are calendar days, `YYYY-MM-DD`: what an
// `<input type=date>` gives and what the `date` columns hold.
export const ASSET_LIMITS = {
  nameMin: 2,
  nameMax: 200,
  lifeMin: 1,
  lifeMax: 120,
  yearMin: 1900,
  yearMax: 2200,
} as const;

const AssetDay = z.iso.date();

export const AssetWrite = Asset.omit({
  id: true,
  tag: true,
  createdAt: true,
  updatedAt: true,
})
  .extend({
    nameEl: z.string().trim().min(ASSET_LIMITS.nameMin).max(ASSET_LIMITS.nameMax),
    installedDate: AssetDay.nullable(),
    commissionedDate: AssetDay.nullable(),
    warrantyEnd: AssetDay.nullable(),
    capitalCost: z.number().min(0).nullable(),
    expectedLifeYears: z.number().int().min(ASSET_LIMITS.lifeMin).max(ASSET_LIMITS.lifeMax).nullable(),
    replacementYear: z.number().int().min(ASSET_LIMITS.yearMin).max(ASSET_LIMITS.yearMax).nullable(),
    replacementCostEst: z.number().min(0).nullable(),
  })
  .partial({
    areaId: true,
    manufacturer: true,
    model: true,
    serialNo: true,
    installedDate: true,
    commissionedDate: true,
    sourceProjectId: true,
    sourceContractId: true,
    capitalCost: true,
    warrantyEnd: true,
    expectedLifeYears: true,
    replacementYear: true,
    replacementCostEst: true,
    condition: true,
    conditionAssessedAt: true,
    parentAssetId: true,
    servesAreaIds: true,
    system: true,
    costCentre: true,
    sapAssetNo: true,
    // Left out of a create, the API fills the default for the asset class
    // (`defaultSapAssetClass`); sent as null, the asset has none.
    sapAssetClass: true,
    status: true,
  });
export type AssetWrite = z.infer<typeof AssetWrite>;

// RULE (UAT 25/11/2026, reported twice): an asset's dates run in order.
// Commissioned on or after installation; the warranty ends on or after
// installation and on or after commissioning; neither installation nor
// commissioning is after today (Europe/Nicosia); the replacement year is
// not before the year of installation. The form and the API both ask this
// one function, so the two cannot disagree. A value that is not a calendar
// day is the schema's to report, not this rule's: it is skipped here.
export type AssetDateRule =
  | "installedInFuture"
  | "commissionedInFuture"
  | "commissionedBeforeInstalled"
  | "warrantyBeforeInstalled"
  | "warrantyBeforeCommissioned"
  | "replacementBeforeInstalled";

export interface AssetDateIssue {
  field: "installedDate" | "commissionedDate" | "warrantyEnd" | "replacementYear";
  rule: AssetDateRule;
}

export interface AssetDates {
  installedDate?: string | null;
  commissionedDate?: string | null;
  warrantyEnd?: string | null;
  replacementYear?: number | null;
}

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function calendarDay(value: unknown): string | null {
  return typeof value === "string" && CALENDAR_DAY.test(value) ? value : null;
}

/** `today` is `YYYY-MM-DD` in Europe/Nicosia — see `nicosiaToday()`. */
export function assetDateIssues(dates: AssetDates, today: string): AssetDateIssue[] {
  const installed = calendarDay(dates.installedDate);
  const commissioned = calendarDay(dates.commissionedDate);
  const warranty = calendarDay(dates.warrantyEnd);
  const issues: AssetDateIssue[] = [];
  if (installed && installed > today) issues.push({ field: "installedDate", rule: "installedInFuture" });
  if (commissioned && commissioned > today) {
    issues.push({ field: "commissionedDate", rule: "commissionedInFuture" });
  }
  if (installed && commissioned && commissioned < installed) {
    issues.push({ field: "commissionedDate", rule: "commissionedBeforeInstalled" });
  }
  if (warranty && installed && warranty < installed) {
    issues.push({ field: "warrantyEnd", rule: "warrantyBeforeInstalled" });
  } else if (warranty && commissioned && warranty < commissioned) {
    issues.push({ field: "warrantyEnd", rule: "warrantyBeforeCommissioned" });
  }
  const year = dates.replacementYear;
  if (installed && typeof year === "number" && year < Number(installed.slice(0, 4))) {
    issues.push({ field: "replacementYear", rule: "replacementBeforeInstalled" });
  }
  return issues;
}

/** Today's calendar day in Cyprus, whatever zone the process runs in. */
export function nicosiaToday(now: Date = new Date()): string {
  // en-CA writes a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Nicosia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

// R28: O&M documents, certificates and the commissioning pack per asset —
// filed with eArchive (ADR-0023), only the protocol number kept here.
export const AssetDocumentKind = z.enum(["OM_MANUAL", "CERT", "COMMISSIONING", "WARRANTY", "DRAWING", "PHOTO"]);
export type AssetDocumentKind = z.infer<typeof AssetDocumentKind>;

export const AssetDocument = z.object({
  id: z.string(),
  assetId: z.string(),
  kind: AssetDocumentKind,
  titleEl: z.string(),
  documentId: z.string(), // eCapital `document` row
  protocolNumber: z.string().nullable(), // eArchive, once filed
  filedAt: z.string().nullable(),
  mime: z.string(),
  size: z.number().int(),
});
export type AssetDocument = z.infer<typeof AssetDocument>;

// A plain reading (meter, condition score, temperature). M5 builds on it.
export const AssetReading = z.object({
  id: z.string(),
  assetId: z.string(),
  takenAt: z.string(),
  readingType: z.string(), // free key, e.g. "RUN_HOURS", "CONDITION"
  value: z.number(),
  unit: z.string().nullable(),
  takenByName: z.string(),
});
export type AssetReading = z.infer<typeof AssetReading>;

// "Full history" for the M4 definition of done: a technician scans the
// label and sees everything that ever touched the asset.
export const AssetHistoryEntry = z.object({
  at: z.string(),
  kind: z.enum(["CREATED", "UPDATED", "CONDITION", "READING", "DOCUMENT", "PROJECT", "CONTRACT", "PERMIT", "WORK_ORDER", "DEFECT"]),
  actorName: z.string().nullable(),
  summaryEl: z.string(),
  href: z.string().nullable(),
});
export type AssetHistoryEntry = z.infer<typeof AssetHistoryEntry>;

export const AssetDetail = Asset.extend({
  areaNameEl: z.string().nullable(),
  buildingCode: z.string().nullable(),
  floorCode: z.string().nullable(),
  orgUnitNameEl: z.string(),
  // The SAP class's names, for the detail screen (null when none is set).
  sapAssetClassNameEl: z.string().nullable(),
  sapAssetClassNameEn: z.string().nullable(),
  sourceProjectCode: z.string().nullable(),
  sourceContractRef: z.string().nullable(),
  parentTag: z.string().nullable(),
  children: z.array(z.object({ id: z.string(), tag: z.string(), nameEl: z.string(), assetClass: AssetClass })),
  documents: z.array(AssetDocument),
  readings: z.array(AssetReading),
  history: z.array(AssetHistoryEntry),
  // R30, lean whole-life view for the CostBar variant on S17: what it
  // cost, what maintenance has cost so far (null until M5 work orders),
  // what replacing it is estimated at.
  wholeLife: z.object({
    capitalCost: z.number().nullable(),
    maintenanceToDate: z.number().nullable(),
    replacementCostEst: z.number().nullable(),
    replacementYear: z.number().int().nullable(),
    ageYears: z.number().nullable(),
    remainingLifeYears: z.number().nullable(),
  }),
  // Open items that block or matter: an open permit touching the asset's
  // area, open handover defects on it.
  openPermits: z.array(z.object({ id: z.string(), ref: z.string().nullable(), status: z.string() })),
  openDefects: z.number().int(),
});
export type AssetDetail = z.infer<typeof AssetDetail>;

export const AssetListQuery = z.object({
  orgUnitId: z.string().optional(),
  areaId: z.string().optional(),
  assetClass: AssetClass.optional(),
  criticality: z.number().int().min(1).max(5).optional(),
  condition: Condition.optional(),
  status: AssetStatus.optional(),
  // A SAP class code, or `NONE` for the assets nobody has classed yet.
  sapAssetClass: z.union([SapAssetClassCode, z.literal("NONE")]).optional(),
  q: z.string().optional(), // tag, name, serial, SAP asset no
  sort: z.enum(["tag", "nameEl", "criticality", "condition", "replacementYear", "updatedAt"]).default("tag"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type AssetListQuery = z.infer<typeof AssetListQuery>;

export const AssetListRow = Asset.pick({
  id: true,
  tag: true,
  nameEl: true,
  assetClass: true,
  criticality: true,
  condition: true,
  status: true,
  replacementYear: true,
  warrantyEnd: true,
  orgUnitId: true,
  areaId: true,
  sapAssetClass: true,
}).extend({
  areaNameEl: z.string().nullable(),
  orgUnitNameEl: z.string(),
  sapAssetClassNameEl: z.string().nullable(),
  sapAssetClassNameEn: z.string().nullable(),
  // S21 (M5) sorts by criticality × condition; the rank is server-side so
  // every list agrees. 1 = most urgent.
  priorityRank: z.number().int().nullable(),
});
export type AssetListRow = z.infer<typeof AssetListRow>;

// R29: QR labels. The payload is a URL, `<APP_ORIGIN>/a/<tag>`, so any
// phone camera opens the asset. Sheets print from the register.
export const QrLabel = z.object({
  assetId: z.string(),
  tag: z.string(),
  nameEl: z.string(),
  areaNameEl: z.string().nullable(),
  url: z.string(),
});
export type QrLabel = z.infer<typeof QrLabel>;

// R30, lean: replacement forecast by year per unit, from `replacementYear`
// and `replacementCostEst`. Feeds the capital pipeline (CAPEX-01 §2 item 2).
// Owner decision 25/11/2026: split by SAP fixed-asset class as well, so the
// figure reaches finance in SAP's own classes; null is the assets with none.
export const ReplacementForecastRow = z.object({
  orgUnitId: z.string(),
  orgUnitNameEl: z.string(),
  sapAssetClass: SapAssetClassCode.nullable(),
  sapAssetClassNameEl: z.string().nullable(),
  sapAssetClassNameEn: z.string().nullable(),
  year: z.number().int(),
  assets: z.number().int(),
  estimatedCost: z.number(),
  criticalAssets: z.number().int(), // criticality 1–2
});
export type ReplacementForecastRow = z.infer<typeof ReplacementForecastRow>;
