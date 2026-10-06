import { z } from "zod";
import { OrgUnit } from "./org-unit";
import { Rag } from "./project";
import { RiskBand } from "./site";
import { Scorecard, SlaBand } from "./maintenance";

// ------------------------------------------------------------------ M6 (R39)
// Αναφορές: the board and management set of CAPEX-01 §11, seven reports,
// each read on the screen, downloaded as Excel with live formulas (house
// convention: blue inputs, black formulas, green cross-sheet links, amber
// assumptions) and printed to PDF from the browser's print view (the same
// path as the S13 permit print; the API runs no browser). ADR-0032.
//
// Every report takes a unit filter (null = the whole of ΟΚΥπΥ the caller may
// see) and a period, and every figure on the screen is the figure in the
// export: one query feeds both. Nothing here is stored.
//
// NO PATIENT DATA. Hospitals, projects, machines, hours and money.

export const ReportKey = z.enum([
  "CAPITAL_PROGRAMME",
  "EXCEPTIONS",
  "CONTRACTOR_SCORECARD",
  "BACKLOG_BY_BAND",
  "ASSET_LIFECYCLE",
  "CLINICAL_DISRUPTION",
  "STATUTORY_COMPLIANCE",
]);
export type ReportKey = z.infer<typeof ReportKey>;

/** The index S23 shows: what each report is, who it is for, which filters it takes. */
export const ReportCatalogueEntry = z.object({
  key: ReportKey,
  /** Which filters apply: a year, a from/to period, a unit, a maintenance agreement. */
  takesYear: z.boolean(),
  takesPeriod: z.boolean(),
  takesUnit: z.boolean(),
  takesAgreement: z.boolean(),
});
export type ReportCatalogueEntry = z.infer<typeof ReportCatalogueEntry>;

/** The filter every report route accepts; a report ignores what it does not take. */
export const ReportQuery = z.object({
  orgUnitId: z.string().optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  from: z.string().optional(), // ISO date, inclusive
  to: z.string().optional(), // ISO date, exclusive
  maintenanceContractId: z.string().optional(),
});
export type ReportQuery = z.infer<typeof ReportQuery>;

/** Stamped on every report so the print and the export say when and for what. */
export const ReportMeta = z.object({
  key: ReportKey,
  generatedAt: z.string(),
  orgUnitId: z.string().nullable(),
  orgUnitName: z.string().nullable(),
  year: z.number().int().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
});
export type ReportMeta = z.infer<typeof ReportMeta>;

// --------------------------------------------- 1. Capital programme by unit --

/**
 * §11: approved, committed, spent, forecast, slippage, % of year elapsed vs
 * % spent. One row per unit the caller may see, the totals row computed by
 * the screen and by a formula in the export, never sent as a figure.
 * `committed`, `spent`, `forecast` are null where the system has no source
 * (CAPEX-01 §7), shown as «—» and left blank in the export.
 */
export const CapitalProgrammeRow = z.object({
  orgUnit: OrgUnit,
  projectCount: z.number().int().nonnegative(),
  approved: z.number(),
  committed: z.number().nullable(),
  spent: z.number().nullable(),
  forecast: z.number().nullable(),
  /** forecast − approved; null when forecast is null. Positive = over. */
  slippage: z.number().nullable(),
  /** spent / approved × 100; null without spent or with approved 0. */
  spentPct: z.number().nullable(),
  rag: z.object({
    green: z.number().int().nonnegative(),
    amber: z.number().int().nonnegative(),
    red: z.number().int().nonnegative(),
  }),
});
export type CapitalProgrammeRow = z.infer<typeof CapitalProgrammeRow>;

export const CapitalProgrammeReport = z.object({
  meta: ReportMeta,
  yearElapsedPct: z.number().min(0).max(100),
  rows: z.array(CapitalProgrammeRow),
});
export type CapitalProgrammeReport = z.infer<typeof CapitalProgrammeReport>;

// ------------------------------------------------------------ 2. Exceptions --

/** §11: projects RAG amber or red with reason and owner. Red first, then amber, then by slippage. */
export const ExceptionRow = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  titleEl: z.string(),
  orgUnitId: z.string(),
  orgUnitName: z.string(),
  phase: z.string(),
  rag: Rag,
  ragReason: z.string(),
  ownerName: z.string().nullable(),
  approved: z.number(),
  forecast: z.number().nullable(),
  slippage: z.number().nullable(),
  /** Days the next milestone is late, null when none is. */
  milestoneLateDays: z.number().int().nullable(),
  openRisksHigh: z.number().int().nonnegative(),
});
export type ExceptionRow = z.infer<typeof ExceptionRow>;

export const ExceptionsReport = z.object({
  meta: ReportMeta,
  rows: z.array(ExceptionRow),
});
export type ExceptionsReport = z.infer<typeof ExceptionsReport>;

// ------------------------------------------------- 3. Contractor scorecard --

/**
 * §11: on-time completion, variation rate, defect rate, SLA breach rate,
 * claim accuracy. Two halves because the organisation has two kinds of
 * contractor: the capital ones (contracts on projects) and the maintenance
 * ones (agreements with timers, M5). Claim accuracy is the share of payment
 * certificate value certified without reduction; where the register has no
 * certificates the field is null.
 */
export const CapitalContractorRow = z.object({
  contractorId: z.string(),
  contractorName: z.string(),
  contracts: z.number().int().nonnegative(),
  contractValue: z.number().nonnegative(),
  /** Contracts past their completion date (plus extension) and not practically complete. */
  overdueContracts: z.number().int().nonnegative(),
  onTimePct: z.number().min(0).max(100).nullable(),
  /** Approved variation value / original value × 100. */
  variationRatePct: z.number().nonnegative().nullable(),
  defects: z.number().int().nonnegative(),
  openDefects: z.number().int().nonnegative(),
  /** Defects per 100.000 € of contract value. */
  defectRate: z.number().nonnegative().nullable(),
  /** RFIs answered after their SLA / RFIs with an SLA × 100. */
  rfiBreachPct: z.number().min(0).max(100).nullable(),
  claimAccuracyPct: z.number().min(0).max(100).nullable(),
});
export type CapitalContractorRow = z.infer<typeof CapitalContractorRow>;

export const ContractorScorecardReport = z.object({
  meta: ReportMeta,
  capital: z.array(CapitalContractorRow),
  /** One M5 scorecard per active maintenance agreement in the caller's units, for the period. */
  maintenance: z.array(Scorecard),
});
export type ContractorScorecardReport = z.infer<typeof ContractorScorecardReport>;

// -------------------------------------------------- 4. Backlog by risk band --

/** §11: by unit and band with the funded / unfunded split. The same figures as S21's summary. */
export const BacklogBandCell = z.object({
  riskBand: RiskBand,
  count: z.number().int().nonnegative(),
  costEstimate: z.number().nonnegative(),
  fundedCost: z.number().nonnegative(),
  unfundedCost: z.number().nonnegative(),
});

export const BacklogByBandRow = z.object({
  orgUnitId: z.string(),
  orgUnitName: z.string(),
  bands: z.array(BacklogBandCell).length(4),
  total: z.number().nonnegative(),
  funded: z.number().nonnegative(),
  unfunded: z.number().nonnegative(),
});
export type BacklogByBandRow = z.infer<typeof BacklogByBandRow>;

export const BacklogByBandReport = z.object({
  meta: ReportMeta,
  rows: z.array(BacklogByBandRow),
});
export type BacklogByBandReport = z.infer<typeof BacklogByBandReport>;

// ------------------------------------------------------ 5. Asset lifecycle --

/**
 * §11: capital cost, cumulative maintenance cost, downtime, remaining life,
 * replacement year. One row per asset in service with a capital cost or a
 * replacement year; maintenance cost and downtime from the work orders.
 */
export const AssetLifecycleRow = z.object({
  assetId: z.string(),
  tag: z.string(),
  nameEl: z.string(),
  orgUnitId: z.string(),
  orgUnitName: z.string(),
  assetClass: z.string(),
  criticality: z.number().int(),
  condition: z.string().nullable(),
  installedYear: z.number().int().nullable(),
  capitalCost: z.number().nullable(),
  maintenanceCost: z.number().nonnegative(),
  correctiveOrders: z.number().int().nonnegative(),
  downtimeHours: z.number().nonnegative(),
  expectedLifeYears: z.number().int().nullable(),
  /** installed year + expected life − report year; null without both inputs. */
  remainingLifeYears: z.number().int().nullable(),
  replacementYear: z.number().int().nullable(),
  replacementCostEst: z.number().nullable(),
  /** maintenanceCost / capitalCost × 100; null without a capital cost. */
  maintenanceToCapitalPct: z.number().nonnegative().nullable(),
});
export type AssetLifecycleRow = z.infer<typeof AssetLifecycleRow>;

export const AssetLifecycleReport = z.object({
  meta: ReportMeta,
  rows: z.array(AssetLifecycleRow),
});
export type AssetLifecycleReport = z.infer<typeof AssetLifecycleReport>;

// ------------------------------------------------- 6. Clinical disruption --

/** §11: theatre and ICU hours lost to planned works, by unit and month. One row per unit, twelve months. */
export const ClinicalDisruptionRow = z.object({
  orgUnitId: z.string(),
  orgUnitName: z.string(),
  months: z
    .array(
      z.object({
        month: z.string(), // YYYY-MM
        theatreHours: z.number().nonnegative(),
        icuHours: z.number().nonnegative(),
        permits: z.number().int().nonnegative(),
      }),
    )
    .length(12),
  theatreHoursTotal: z.number().nonnegative(),
  icuHoursTotal: z.number().nonnegative(),
  permitsTotal: z.number().int().nonnegative(),
});
export type ClinicalDisruptionRow = z.infer<typeof ClinicalDisruptionRow>;

export const ClinicalDisruptionReport = z.object({
  meta: ReportMeta,
  rows: z.array(ClinicalDisruptionRow),
});
export type ClinicalDisruptionReport = z.infer<typeof ClinicalDisruptionReport>;

// ------------------------------------------------ 7. Statutory compliance --

/**
 * §11: lifts, pressure vessels, medical gas, fire systems — due, done,
 * overdue. Counted from the preventive programme's orders and the STATUTORY
 * work orders of the year, grouped by the statutory category a catalogue
 * system or an asset class maps to (ADR-0032 has the mapping).
 */
export const StatutoryCategory = z.enum(["LIFTS", "PRESSURE_VESSELS", "MEDICAL_GAS", "FIRE_SYSTEMS"]);
export type StatutoryCategory = z.infer<typeof StatutoryCategory>;

export const StatutoryCell = z.object({
  category: StatutoryCategory,
  due: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  overdue: z.number().int().nonnegative(),
  /** done / due × 100; null when nothing was due. */
  donePct: z.number().min(0).max(100).nullable(),
});

export const StatutoryComplianceRow = z.object({
  orgUnitId: z.string(),
  orgUnitName: z.string(),
  cells: z.array(StatutoryCell).length(4),
});
export type StatutoryComplianceRow = z.infer<typeof StatutoryComplianceRow>;

export const StatutoryComplianceReport = z.object({
  meta: ReportMeta,
  rows: z.array(StatutoryComplianceRow),
});
export type StatutoryComplianceReport = z.infer<typeof StatutoryComplianceReport>;

// ------------------------------------------------------------------ rules --

/** The band order every report prints in. */
export const BAND_ORDER: SlaBand[] = ["CRITICAL", "P1", "P2"];
export const RISK_BAND_ORDER: RiskBand[] = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"];

/** Which report takes which filter. The screen and the API read the same table. */
export const REPORT_CATALOGUE: ReportCatalogueEntry[] = [
  { key: "CAPITAL_PROGRAMME", takesYear: true, takesPeriod: false, takesUnit: true, takesAgreement: false },
  { key: "EXCEPTIONS", takesYear: false, takesPeriod: false, takesUnit: true, takesAgreement: false },
  { key: "CONTRACTOR_SCORECARD", takesYear: false, takesPeriod: true, takesUnit: true, takesAgreement: false },
  { key: "BACKLOG_BY_BAND", takesYear: false, takesPeriod: false, takesUnit: true, takesAgreement: false },
  { key: "ASSET_LIFECYCLE", takesYear: true, takesPeriod: false, takesUnit: true, takesAgreement: false },
  { key: "CLINICAL_DISRUPTION", takesYear: true, takesPeriod: false, takesUnit: true, takesAgreement: false },
  { key: "STATUTORY_COMPLIANCE", takesYear: true, takesPeriod: false, takesUnit: true, takesAgreement: false },
];

/** The route segment of a report: `/reports/<slug>` on both ends. */
export const REPORT_SLUG: Record<ReportKey, string> = {
  CAPITAL_PROGRAMME: "capital-programme",
  EXCEPTIONS: "exceptions",
  CONTRACTOR_SCORECARD: "contractor-scorecard",
  BACKLOG_BY_BAND: "backlog-by-band",
  ASSET_LIFECYCLE: "asset-lifecycle",
  CLINICAL_DISRUPTION: "clinical-disruption",
  STATUTORY_COMPLIANCE: "statutory-compliance",
};

/** Share of a calendar year elapsed at a date, 0–100, the S01 figure. */
export function yearElapsedPct(isoDate: string): number {
  const d = new Date(isoDate);
  const year = d.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const pct = ((d.getTime() - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct * 10) / 10));
}
