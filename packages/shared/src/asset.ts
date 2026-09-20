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
  status: AssetStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Asset = z.infer<typeof Asset>;

export const AssetWrite = Asset.omit({
  id: true,
  tag: true,
  createdAt: true,
  updatedAt: true,
}).partial({
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
  status: true,
});
export type AssetWrite = z.infer<typeof AssetWrite>;

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
}).extend({
  areaNameEl: z.string().nullable(),
  orgUnitNameEl: z.string(),
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
export const ReplacementForecastRow = z.object({
  orgUnitId: z.string(),
  orgUnitNameEl: z.string(),
  year: z.number().int(),
  assets: z.number().int(),
  estimatedCost: z.number(),
  criticalAssets: z.number().int(), // criticality 1–2
});
export type ReplacementForecastRow = z.infer<typeof ReplacementForecastRow>;
