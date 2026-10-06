/**
 * The arithmetic of the seven reports (ADR-0032), pure: the service reads
 * the rows, these functions make the figures, and the workbook writes the
 * same arithmetic again as formulas. Every rate that has nothing under it
 * is null, never zero (CAPEX-01 §7).
 */
import {
  type AssetLifecycleRow,
  type CapitalContractorRow,
  type ExceptionRow,
  type Rag,
  yearElapsedPct,
} from "@ecapital/shared";

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** a / b × 100 rounded to two places; null without a denominator. */
export function pctOf(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return round2((numerator / denominator) * 100);
}

// ------------------------------------------------- capital programme --

/**
 * RULE (ADR-0032, the S01 comparator): this year's share elapsed today; a
 * year that is over is 100, one that has not started is 0.
 */
export function yearElapsedFor(year: number, now: Date): number {
  const current = now.getUTCFullYear();
  if (year < current) return 100;
  if (year > current) return 0;
  return yearElapsedPct(now.toISOString());
}

/**
 * RULE (CAPEX-01 §7, the portfolio's `committedOf`): a set of ledgers adds up
 * over the members that know theirs; none knowing is null, never zero.
 */
export function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  if (!known.length) return null;
  return round2(known.reduce((sum, v) => sum + v, 0));
}

/**
 * RULE (ADR-0032): a unit's forecast is the sum of its projects' forecasts
 * when every project has one, and null otherwise. A partial sum set against
 * the whole approved budget would read as an underspend that is only the
 * projects nobody has forecast yet.
 */
export function sumComplete(values: (number | null)[]): number | null {
  if (!values.length || values.some((v) => v === null)) return null;
  return round2((values as number[]).reduce((sum, v) => sum + v, 0));
}

export function slippageOf(forecast: number | null, approved: number): number | null {
  return forecast === null ? null : round2(forecast - approved);
}

// ---------------------------------------------------------- exceptions --

/** RULE (S06 risk matrix): likelihood × impact above 12 of 25 is high. */
export const HIGH_RISK_ABOVE = 12;

export function isHighRisk(likelihood: number, impact: number): boolean {
  return likelihood * impact > HIGH_RISK_ABOVE;
}

/**
 * The worst lateness among the milestones not yet achieved: today minus the
 * forecast date (the baseline where there is no forecast), in whole days.
 * Null when none of them is past its date.
 */
export function milestoneLateDays(
  milestones: { baselineDate: string; forecastDate: string | null; actualDate: string | null }[],
  today: string,
): number | null {
  const at = Date.parse(`${today}T00:00:00Z`);
  let worst: number | null = null;
  for (const m of milestones) {
    if (m.actualDate) continue;
    const due = Date.parse(`${m.forecastDate ?? m.baselineDate}T00:00:00Z`);
    const days = Math.round((at - due) / 86_400_000);
    if (days > 0 && (worst === null || days > worst)) worst = days;
  }
  return worst;
}

const RAG_WEIGHT: Record<Rag, number> = { RED: 2, AMBER: 1, GREEN: 0 };

/** §11: red first, then amber, then the biggest slippage; no slippage last. */
export function sortExceptions(rows: ExceptionRow[]): ExceptionRow[] {
  return [...rows].sort((a, b) => {
    const rag = RAG_WEIGHT[b.rag] - RAG_WEIGHT[a.rag];
    if (rag) return rag;
    if (a.slippage !== b.slippage) {
      if (a.slippage === null) return 1;
      if (b.slippage === null) return -1;
      return b.slippage - a.slippage;
    }
    return a.projectCode.localeCompare(b.projectCode);
  });
}

// ------------------------------------------------ contractor scorecard --

/** ADR-0032 §5: defects are counted per this much contract value. */
export const DEFECT_RATE_BASE = 100_000;

/** What the register holds about one contractor's capital contracts, summed. */
export interface CapitalContractorFacts {
  contractorId: string;
  contractorName: string;
  contracts: number;
  /** Contracts with a completion date: the base of the on-time share. */
  datedContracts: number;
  overdueContracts: number;
  originalValue: number;
  approvedVariations: number;
  /** Σ current value: the original plus the approved variations. */
  contractValue: number;
  defects: number;
  openDefects: number;
  rfis: number;
  rfisLate: number;
  /** Certificates the engineer has decided (past DRAFT). */
  certificates: number;
  /** Σ net payable of those certificates as raised. */
  certifiedClaimed: number;
  /** Σ net payable of those certificates as certified. */
  certifiedApproved: number;
}

/**
 * RULE (ADR-0032 §5), each rate null where the register has nothing under it:
 *   on time      (dated − overdue) / dated;
 *   variations   approved variations / original value;
 *   defect rate  defects per DEFECT_RATE_BASE of contract value;
 *   RFI breach   late RFIs / RFIs;
 *   claims       decided certificates' value as certified / as raised.
 */
export function capitalContractorRow(f: CapitalContractorFacts): CapitalContractorRow {
  const claims =
    f.certificates > 0 && f.certifiedClaimed > 0
      ? Math.min(100, Math.max(0, pctOf(f.certifiedApproved, f.certifiedClaimed) as number))
      : null;
  return {
    contractorId: f.contractorId,
    contractorName: f.contractorName,
    contracts: f.contracts,
    contractValue: round2(f.contractValue),
    overdueContracts: f.overdueContracts,
    onTimePct: pctOf(f.datedContracts - f.overdueContracts, f.datedContracts),
    variationRatePct: pctOf(f.approvedVariations, f.originalValue),
    defects: f.defects,
    openDefects: f.openDefects,
    defectRate: f.contractValue > 0 ? round2((f.defects / f.contractValue) * DEFECT_RATE_BASE) : null,
    rfiBreachPct: pctOf(f.rfisLate, f.rfis),
    claimAccuracyPct: claims,
  };
}

// ---------------------------------------------------- asset lifecycle --

export interface LifecycleAsset {
  assetId: string;
  tag: string;
  nameEl: string;
  orgUnitId: string;
  orgUnitName: string;
  assetClass: string;
  criticality: number;
  condition: string | null;
  installedDate: string | null;
  commissionedDate: string | null;
  capitalCost: number | null;
  expectedLifeYears: number | null;
  replacementYear: number | null;
  replacementCostEst: number | null;
}

export interface LifecycleOrders {
  maintenanceCost: number;
  correctiveOrders: number;
  downtimeHours: number;
}

/**
 * RULE (§11): remaining life is the installed year plus the expected life
 * minus the report year (commissioning stands in for an installation nobody
 * dated); the maintenance-to-capital ratio needs a capital cost.
 */
export function assetLifecycleRow(
  asset: LifecycleAsset,
  orders: LifecycleOrders,
  year: number,
): AssetLifecycleRow {
  const installed = asset.installedDate ?? asset.commissionedDate;
  const installedYear = installed ? Number(installed.slice(0, 4)) : null;
  return {
    assetId: asset.assetId,
    tag: asset.tag,
    nameEl: asset.nameEl,
    orgUnitId: asset.orgUnitId,
    orgUnitName: asset.orgUnitName,
    assetClass: asset.assetClass,
    criticality: asset.criticality,
    condition: asset.condition,
    installedYear,
    capitalCost: asset.capitalCost,
    maintenanceCost: round2(orders.maintenanceCost),
    correctiveOrders: orders.correctiveOrders,
    downtimeHours: round2(orders.downtimeHours),
    expectedLifeYears: asset.expectedLifeYears,
    remainingLifeYears:
      installedYear === null || asset.expectedLifeYears === null
        ? null
        : installedYear + asset.expectedLifeYears - year,
    replacementYear: asset.replacementYear,
    replacementCostEst: asset.replacementCostEst,
    maintenanceToCapitalPct:
      asset.capitalCost !== null && asset.capitalCost > 0
        ? pctOf(orders.maintenanceCost, asset.capitalCost)
        : null,
  };
}

/** Shortest remaining life first; an asset whose life cannot be worked out last. */
export function sortLifecycle(rows: AssetLifecycleRow[]): AssetLifecycleRow[] {
  return [...rows].sort((a, b) => {
    if (a.remainingLifeYears !== b.remainingLifeYears) {
      if (a.remainingLifeYears === null) return 1;
      if (b.remainingLifeYears === null) return -1;
      return a.remainingLifeYears - b.remainingLifeYears;
    }
    return a.tag.localeCompare(b.tag);
  });
}

// -------------------------------------------------- clinical disruption --

/** The twelve `YYYY-MM` of a year. */
export function monthsOf(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}
