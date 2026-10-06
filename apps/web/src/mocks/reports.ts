// M6 (R39, ADR-0032) — fixtures for the seven reports, typed by
// `packages/shared/src/reports.ts`. They feed the preview gallery and the
// S23/S23a tests (ADR-0005), never a route a screen fetches from. Round,
// obviously fake figures; hospitals, projects, machines, hours and money,
// never a patient.
//
// Each report carries at least one null where its contract allows one, so
// a test can check that the screen shows «—» for it and never «0».
import {
  OrgUnit,
  REPORT_CATALOGUE,
  type AssetLifecycleReport,
  type BacklogByBandReport,
  type CapitalProgrammeReport,
  type ClinicalDisruptionReport,
  type ContractorScorecardReport,
  type ExceptionsReport,
  type ReportCatalogueEntry,
  type ReportKey,
  type ReportMeta,
  type StatutoryComplianceReport,
} from "@ecapital/shared";
import type { ReportData } from "@/data/queries";
import { buildScorecard } from "./maintenance";
import { orgUnits } from "./org-units";

const GENERATED_AT = "2026-10-06T08:30:00Z";

function unit(id: string): OrgUnit {
  const found = orgUnits.find((u) => u.id === id);
  if (!found) throw new Error(`no mock unit ${id}`);
  // The contract's own parse drops the mock's `aliases`.
  return OrgUnit.parse(found);
}

const NICOSIA = unit("nicosia-general");
const LARNACA = unit("larnaca-general");
const LIMASSOL = unit("limassol-general");

export function buildReportCatalogue(): ReportCatalogueEntry[] {
  return REPORT_CATALOGUE.map((entry) => ({ ...entry }));
}

export function buildReportMeta(key: ReportKey, overrides: Partial<ReportMeta> = {}): ReportMeta {
  const takesPeriod = REPORT_CATALOGUE.find((e) => e.key === key)?.takesPeriod ?? false;
  const takesYear = REPORT_CATALOGUE.find((e) => e.key === key)?.takesYear ?? false;
  return {
    key,
    generatedAt: GENERATED_AT,
    orgUnitId: null,
    orgUnitName: null,
    year: takesYear ? 2026 : null,
    from: takesPeriod ? "2026-07-01" : null,
    to: takesPeriod ? "2026-10-01" : null,
    ...overrides,
  };
}

export function buildCapitalProgrammeReport(overrides: Partial<CapitalProgrammeReport> = {}): CapitalProgrammeReport {
  return {
    meta: buildReportMeta("CAPITAL_PROGRAMME"),
    yearElapsedPct: 76.4,
    rows: [
      {
        orgUnit: NICOSIA,
        projectCount: 12,
        approved: 4_000_000,
        committed: 2_500_000,
        spent: 1_800_000,
        forecast: 4_200_000,
        slippage: 200_000,
        spentPct: 45,
        rag: { green: 8, amber: 3, red: 1 },
      },
      {
        orgUnit: LARNACA,
        projectCount: 6,
        approved: 1_500_000,
        committed: 900_000,
        spent: 1_200_000,
        forecast: 1_400_000,
        slippage: -100_000,
        spentPct: 80,
        rag: { green: 5, amber: 1, red: 0 },
      },
      {
        // RULE (contract): no ledger source yet — every figure that depends on it is null.
        orgUnit: LIMASSOL,
        projectCount: 4,
        approved: 800_000,
        committed: null,
        spent: null,
        forecast: null,
        slippage: null,
        spentPct: null,
        rag: { green: 2, amber: 0, red: 2 },
      },
    ],
    ...overrides,
  };
}

export function buildExceptionsReport(overrides: Partial<ExceptionsReport> = {}): ExceptionsReport {
  return {
    meta: buildReportMeta("EXCEPTIONS"),
    rows: [
      {
        projectId: "p-101",
        projectCode: "NGH-2026-004",
        titleEl: "Αναβάθμιση κεντρικής κλιματιστικής μονάδας",
        orgUnitId: NICOSIA.id,
        orgUnitName: NICOSIA.nameEl,
        phase: "IN_PROGRESS",
        rag: "RED",
        ragReason: "Η πρόβλεψη ξεπερνά τον εγκεκριμένο προϋπολογισμό κατά 10 %.",
        ownerName: "Μηχανικός Δείγμα Α",
        approved: 1_000_000,
        forecast: 1_100_000,
        slippage: 100_000,
        milestoneLateDays: 21,
        openRisksHigh: 2,
      },
      {
        projectId: "p-102",
        projectCode: "LAR-2026-002",
        titleEl: "Αντικατάσταση ανελκυστήρα πτέρυγας Β",
        orgUnitId: LARNACA.id,
        orgUnitName: LARNACA.nameEl,
        phase: "TENDERED",
        rag: "AMBER",
        ragReason: "Το ορόσημο ανάθεσης καθυστερεί.",
        ownerName: null,
        approved: 300_000,
        forecast: null,
        slippage: null,
        milestoneLateDays: null,
        openRisksHigh: 0,
      },
    ],
    ...overrides,
  };
}

export function buildContractorScorecardReport(overrides: Partial<ContractorScorecardReport> = {}): ContractorScorecardReport {
  return {
    meta: buildReportMeta("CONTRACTOR_SCORECARD"),
    capital: [
      {
        contractorId: "c-1",
        contractorName: "Δείγμα Κατασκευαστική Λτδ",
        contracts: 4,
        contractValue: 2_400_000,
        overdueContracts: 1,
        onTimePct: 75,
        variationRatePct: 6.5,
        defects: 9,
        openDefects: 3,
        defectRate: 0.4,
        rfiBreachPct: 12.5,
        claimAccuracyPct: 92,
      },
      {
        contractorId: "c-2",
        contractorName: "Δείγμα Ηλεκτρομηχανική Λτδ",
        contracts: 1,
        contractValue: 150_000,
        overdueContracts: 0,
        onTimePct: null,
        variationRatePct: null,
        defects: 0,
        openDefects: 0,
        defectRate: null,
        rfiBreachPct: null,
        claimAccuracyPct: null,
      },
    ],
    maintenance: [buildScorecard()],
    ...overrides,
  };
}

const BANDS = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"] as const;

export function buildBacklogByBandReport(overrides: Partial<BacklogByBandReport> = {}): BacklogByBandReport {
  const row = (u: OrgUnit, figures: [number, number, number][]) => {
    const bands = BANDS.map((riskBand, i) => {
      const [count, funded, unfunded] = figures[i];
      return { riskBand, count, costEstimate: funded + unfunded, fundedCost: funded, unfundedCost: unfunded };
    });
    const funded = bands.reduce((s, b) => s + b.fundedCost, 0);
    const unfunded = bands.reduce((s, b) => s + b.unfundedCost, 0);
    return { orgUnitId: u.id, orgUnitName: u.nameEl, bands, total: funded + unfunded, funded, unfunded };
  };
  return {
    meta: buildReportMeta("BACKLOG_BY_BAND"),
    rows: [
      row(NICOSIA, [
        [3, 100_000, 250_000],
        [5, 0, 120_000],
        [2, 20_000, 10_000],
        [0, 0, 0],
      ]),
      row(LARNACA, [
        [1, 0, 80_000],
        [0, 0, 0],
        [4, 0, 40_000],
        [2, 5_000, 0],
      ]),
    ],
    ...overrides,
  };
}

export function buildAssetLifecycleReport(overrides: Partial<AssetLifecycleReport> = {}): AssetLifecycleReport {
  return {
    meta: buildReportMeta("ASSET_LIFECYCLE"),
    rows: [
      {
        assetId: "a-1",
        tag: "NGH-HVAC-0001",
        nameEl: "Ψύκτης νερού 1",
        orgUnitId: NICOSIA.id,
        orgUnitName: NICOSIA.nameEl,
        assetClass: "HVAC",
        criticality: 2,
        condition: "C",
        installedYear: 2008,
        capitalCost: 250_000,
        maintenanceCost: 62_500,
        correctiveOrders: 7,
        downtimeHours: 36.5,
        expectedLifeYears: 20,
        remainingLifeYears: 2,
        replacementYear: 2028,
        replacementCostEst: 320_000,
        maintenanceToCapitalPct: 25,
      },
      {
        assetId: "a-2",
        tag: "LAR-LIFT-0002",
        nameEl: "Ανελκυστήρας ασθενοφόρων Β",
        orgUnitId: LARNACA.id,
        orgUnitName: LARNACA.nameEl,
        assetClass: "LIFT",
        criticality: 1,
        condition: "D",
        installedYear: 1999,
        capitalCost: 120_000,
        maintenanceCost: 48_000,
        correctiveOrders: 11,
        downtimeHours: 120,
        expectedLifeYears: 25,
        remainingLifeYears: -2,
        replacementYear: 2027,
        replacementCostEst: 180_000,
        maintenanceToCapitalPct: 40,
      },
      {
        assetId: "a-3",
        tag: "NGH-ELEC-0003",
        nameEl: "Ηλεκτροπαραγωγό ζεύγος 2",
        orgUnitId: NICOSIA.id,
        orgUnitName: NICOSIA.nameEl,
        assetClass: "ELECTRICAL",
        criticality: 3,
        condition: null,
        installedYear: null,
        capitalCost: null,
        maintenanceCost: 4_000,
        correctiveOrders: 1,
        downtimeHours: 0,
        expectedLifeYears: null,
        remainingLifeYears: null,
        replacementYear: 2031,
        replacementCostEst: null,
        maintenanceToCapitalPct: null,
      },
    ],
    ...overrides,
  };
}

export function buildClinicalDisruptionReport(overrides: Partial<ClinicalDisruptionReport> = {}): ClinicalDisruptionReport {
  const months = (theatre: number[], icu: number[]) =>
    theatre.map((h, i) => ({ month: `2026-${String(i + 1).padStart(2, "0")}`, theatreHours: h, icuHours: icu[i], permits: h + icu[i] > 0 ? 1 : 0 }));
  const row = (u: OrgUnit, theatre: number[], icu: number[]) => {
    const m = months(theatre, icu);
    return {
      orgUnitId: u.id,
      orgUnitName: u.nameEl,
      months: m,
      theatreHoursTotal: m.reduce((s, x) => s + x.theatreHours, 0),
      icuHoursTotal: m.reduce((s, x) => s + x.icuHours, 0),
      permitsTotal: m.reduce((s, x) => s + x.permits, 0),
    };
  };
  return {
    meta: buildReportMeta("CLINICAL_DISRUPTION"),
    rows: [
      row(NICOSIA, [0, 4, 0, 0, 8, 0, 0, 0, 3.5, 6, 0, 0], [0, 0, 2, 0, 0, 0, 12, 0, 0, 0, 0, 0]),
      row(LARNACA, [0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ],
    ...overrides,
  };
}

export function buildStatutoryComplianceReport(overrides: Partial<StatutoryComplianceReport> = {}): StatutoryComplianceReport {
  return {
    meta: buildReportMeta("STATUTORY_COMPLIANCE"),
    rows: [
      {
        orgUnitId: NICOSIA.id,
        orgUnitName: NICOSIA.nameEl,
        cells: [
          { category: "LIFTS", due: 40, done: 39, overdue: 1, donePct: 97.5 },
          { category: "PRESSURE_VESSELS", due: 10, done: 8, overdue: 2, donePct: 80 },
          { category: "MEDICAL_GAS", due: 12, done: 6, overdue: 6, donePct: 50 },
          { category: "FIRE_SYSTEMS", due: 0, done: 0, overdue: 0, donePct: null },
        ],
      },
      {
        orgUnitId: LARNACA.id,
        orgUnitName: LARNACA.nameEl,
        cells: [
          { category: "LIFTS", due: 20, done: 20, overdue: 0, donePct: 100 },
          { category: "PRESSURE_VESSELS", due: 4, done: 3, overdue: 1, donePct: 75 },
          { category: "MEDICAL_GAS", due: 6, done: 6, overdue: 0, donePct: 100 },
          { category: "FIRE_SYSTEMS", due: 8, done: 7, overdue: 1, donePct: 87.5 },
        ],
      },
    ],
    ...overrides,
  };
}

/** Any report by key, for the tests and the preview that loop over all seven. */
export function buildReport<K extends ReportKey>(key: K): ReportData[K] {
  const builders: { [P in ReportKey]: () => ReportData[P] } = {
    CAPITAL_PROGRAMME: () => buildCapitalProgrammeReport(),
    EXCEPTIONS: () => buildExceptionsReport(),
    CONTRACTOR_SCORECARD: () => buildContractorScorecardReport(),
    BACKLOG_BY_BAND: () => buildBacklogByBandReport(),
    ASSET_LIFECYCLE: () => buildAssetLifecycleReport(),
    CLINICAL_DISRUPTION: () => buildClinicalDisruptionReport(),
    STATUTORY_COMPLIANCE: () => buildStatutoryComplianceReport(),
  };
  return builders[key]();
}
