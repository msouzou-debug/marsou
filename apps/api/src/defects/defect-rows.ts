/**
 * Turning defect rows into the shape packages/shared publishes, and the two
 * rules that are pure functions of a row: the defects-liability arithmetic of
 * R12 and the backlog banding of R35.
 *
 * Kept out of the service so both can be unit-tested without a database.
 */
import type { Defect, DefectBacklogRow, RiskBand } from "@ecapital/shared";

/** numeric arrives from pg as a string so no precision is lost in transit. */
export function money(value: string | number | null): number {
  if (value === null) return 0;
  return typeof value === "number" ? value : Number(value);
}

/**
 * RULE (R12): a handover defect must be closed inside the defects liability
 * period, so its due date is the day that period ends —
 *
 *   contract completion date + extension days + defects liability months
 *
 * Extensions come first because they move the completion date itself: a
 * contract finished thirty days late starts its liability period thirty days
 * late. Months are added by calendar and not by thirty-day blocks, because a
 * twelve-month liability that ends on the 30th of February would be a
 * liability nobody could point at; the day is clamped to the end of the month
 * it lands in, which is what «δώδεκα μήνες από την παραλαβή» means.
 *
 * A contract with no completion date has no period to end, so the answer is
 * null and the defect simply has no due date. Every other source of defect —
 * an inspection round, a work order, a condition survey — has no liability
 * period at all and also gets null (CAPEX-01 §4).
 */
export function handoverDueDate(
  completionDate: string | null,
  extensionDays: number,
  defectsLiabilityMonths: number,
): string | null {
  if (completionDate === null) return null;
  return addMonths(addDays(completionDate, extensionDays), defectsLiabilityMonths);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Calendar months, with the day clamped to the end of the month it lands in. */
export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export interface DefectRow {
  id: string;
  orgUnitId: string;
  source: Defect["source"];
  contractId: string | null;
  projectId: string | null;
  areaId: string | null;
  assetId: string | null;
  descriptionEl: string;
  photoIds: string[] | null;
  estimatedCost: string | number | null;
  riskBand: RiskBand;
  funded: boolean;
  targetProjectId: string | null;
  status: Defect["status"];
  raisedById: string;
  raisedByName: string | null;
  raisedAt: Date;
  dueDate: string | null;
  closedAt: Date | null;
  closedById: string | null;
  closedByName: string | null;
}

export function toDefect(row: DefectRow): Defect {
  return {
    id: row.id,
    orgUnitId: row.orgUnitId,
    source: row.source,
    contractId: row.contractId,
    projectId: row.projectId,
    areaId: row.areaId,
    assetId: row.assetId,
    descriptionEl: row.descriptionEl,
    photoIds: row.photoIds ?? [],
    // Null is a real answer here: nobody has priced this one yet, which is
    // not the same as pricing it at zero (CAPEX-01 §7, the same rule the
    // ledgers follow).
    estimatedCost: row.estimatedCost === null ? null : money(row.estimatedCost),
    riskBand: row.riskBand,
    funded: row.funded,
    targetProjectId: row.targetProjectId,
    status: row.status,
    raisedById: row.raisedById,
    raisedByName: row.raisedByName ?? "",
    raisedAt: row.raisedAt.toISOString(),
    dueDate: row.dueDate,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closedById: row.closedById,
    closedByName: row.closedByName,
  };
}

/** The four bands, worst first — the order the backlog report reads in. */
export const RISK_BANDS: RiskBand[] = ["HIGH", "SIGNIFICANT", "MODERATE", "LOW"];

/** The statuses that count as backlog: work still to do (R35). */
export const BACKLOG_STATUSES: Defect["status"][] = ["OPEN", "IN_PROGRESS"];

export interface BacklogInput {
  orgUnitId: string;
  riskBand: RiskBand;
  estimatedCost: string | number | null;
  funded: boolean;
}

/**
 * RULE (R35, CAPEX-01 §2, NHS ERIC): the backlog is every defect still to be
 * dealt with, costed and banded by risk, grouped by hospital. `estimatedCost`
 * is the whole cost of the band, and `funded` plus `unfunded` split it by
 * whether a capital project is paying — the two always add up to the total,
 * which is what makes the unfunded column the figure next year's programme is
 * argued from.
 *
 * A defect nobody has priced counts in `count` and adds nothing to the money.
 * Pretending it costs zero would understate the backlog; leaving it out of
 * the count would hide it.
 */
export function backlogRows(defects: BacklogInput[]): DefectBacklogRow[] {
  const byKey = new Map<string, DefectBacklogRow>();
  for (const defect of defects) {
    const key = `${defect.orgUnitId}\u0000${defect.riskBand}`;
    const row = byKey.get(key) ?? {
      orgUnitId: defect.orgUnitId,
      riskBand: defect.riskBand,
      count: 0,
      estimatedCost: 0,
      funded: 0,
      unfunded: 0,
    };
    const cost = defect.estimatedCost === null ? 0 : money(defect.estimatedCost);
    row.count += 1;
    row.estimatedCost = round2(row.estimatedCost + cost);
    if (defect.funded) row.funded = round2(row.funded + cost);
    else row.unfunded = round2(row.unfunded + cost);
    byKey.set(key, row);
  }

  return [...byKey.values()].sort(
    (a, b) =>
      a.orgUnitId.localeCompare(b.orgUnitId) ||
      RISK_BANDS.indexOf(a.riskBand) - RISK_BANDS.indexOf(b.riskBand),
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
