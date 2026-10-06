/**
 * R37 — the contractor scorecard, computed on read from the orders (ADR-0031
 * §9). Pure: the service hands in the agreement, the orders and `now`, and
 * the same arithmetic the Excel export writes as formulas comes back as
 * numbers. Nothing here is stored, so the figures always agree with the list.
 *
 * Which orders count:
 *  - Everything except PM's own ratio reads the orders **called** inside
 *    [from, to). A cancelled order is a withdrawn call and counts nowhere.
 *  - The PM ratio reads the PM orders whose **programme date** falls inside
 *    [from, to), whenever they were issued — a visit due in March is March's
 *    visit even if the sweep issued it in February.
 *
 * The three timers (ADR-0031 §3): response is met by `respondedAt`, restore
 * by `restoredAt` (or `completedAt`, which sets it), report by
 * `reportReceivedAt`. `dueRestoreAt` already carries any extension.
 *
 * Penalties are hours (response, restore) or started days (PM) late, times
 * the system's rate. An open timer is late up to `now`. Where a late line's
 * system has no rate the line is counted, the amount is left out and
 * `ratesMissing` says so — the Nicosia amounts did not survive the copy we
 * were given (ADR-0031 §2), and a guessed figure would be withheld from
 * somebody's payment.
 */
import type { SlaBand, Scorecard } from "@ecapital/shared";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The availability clause is per year; 8760 is the year it is a share of. */
export const HOURS_PER_YEAR = 8760;

export interface ScoreOrder {
  id: string;
  ref: string;
  kind: "CORRECTIVE" | "PM" | "STATUTORY";
  status: string;
  band: SlaBand | null;
  slaSystemCode: string | null;
  slaSystemName: string | null;
  assetId: string | null;
  calledAt: string;
  dueResponseAt: string | null;
  respondedAt: string | null;
  dueRestoreAt: string | null;
  restoredAt: string | null;
  completedAt: string | null;
  dueReportAt: string | null;
  reportReceivedAt: string | null;
  dueDate: string | null;
  penaltyPmPerDay: number | null;
  penaltyResponsePerHour: number | null;
  penaltyRestorePerHour: number | null;
}

export interface ScoreContract {
  id: string;
  ref: string;
  contractorName: string;
  availabilityHoursYear: number;
  availabilityPenaltyCriticalPerHour: number;
  availabilityPenaltyOtherPerHour: number;
  contractValue: number | null;
}

export interface ScoreInput {
  contract: ScoreContract;
  /** ISO dates, `from` inclusive, `to` exclusive. */
  from: string;
  to: string;
  now: string;
  orders: ScoreOrder[];
}

function startOf(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
}

/** Called inside the period and not withdrawn. */
export function inCallPeriod(order: ScoreOrder, from: string, to: string): boolean {
  const at = Date.parse(order.calledAt);
  return order.status !== "CANCELLED" && at >= startOf(from) && at < startOf(to);
}

/** A PM visit whose programme date is inside the period. */
export function inPmPeriod(order: ScoreOrder, from: string, to: string): boolean {
  if (order.kind !== "PM" || order.status === "CANCELLED" || !order.dueDate) return false;
  const due = startOf(order.dueDate);
  return due >= startOf(from) && due < startOf(to);
}

/** Hours past a deadline, met or still open (to `now`). Zero when on time or no deadline. */
export function lateHours(due: string | null, met: string | null, now: string): number {
  if (!due) return 0;
  return Math.max(0, (Date.parse(met ?? now) - Date.parse(due)) / HOUR_MS);
}

/** Started days past the programme deadline: a visit one hour late is a day late. */
export function lateDays(due: string | null, met: string | null, now: string): number {
  if (!due) return 0;
  const late = (Date.parse(met ?? now) - Date.parse(due)) / DAY_MS;
  return late > 0 ? Math.ceil(late) : 0;
}

/** Calendar hours from the call to the restore (or the close), or to now. */
export function downtime(order: ScoreOrder, now: string): number {
  const end = order.restoredAt ?? order.completedAt ?? now;
  return Math.max(0, (Date.parse(end) - Date.parse(order.calledAt)) / HOUR_MS);
}

function onTime(due: string | null, met: string | null): boolean {
  return Boolean(due && met && Date.parse(met) <= Date.parse(due));
}

function pct(onTimeCount: number, due: number): number | null {
  return due ? round1((onTimeCount / due) * 100) : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const BANDS: SlaBand[] = ["CRITICAL", "P1", "P2"];

export function computeScorecard(input: ScoreInput): Scorecard {
  const { contract, from, to, now } = input;
  const called = input.orders.filter((o) => inCallPeriod(o, from, to));
  const timed = called.filter((o) => o.kind !== "PM");
  const corrective = called.filter((o) => o.kind === "CORRECTIVE");
  const pmDue = input.orders.filter((o) => inPmPeriod(o, from, to));

  let ratesMissing = false;

  // ---------------------------------------------------------- ratios --
  const responseDue = timed.filter((o) => o.dueResponseAt);
  const restoreDue = timed.filter((o) => o.dueRestoreAt);
  const reportDue = timed.filter((o) => o.dueReportAt);
  const response = {
    due: responseDue.length,
    onTime: responseDue.filter((o) => onTime(o.dueResponseAt, o.respondedAt)).length,
  };
  const restore = {
    due: restoreDue.length,
    onTime: restoreDue.filter((o) => onTime(o.dueRestoreAt, o.restoredAt ?? o.completedAt)).length,
  };
  const report = {
    due: reportDue.length,
    onTime: reportDue.filter((o) => onTime(o.dueReportAt, o.reportReceivedAt)).length,
  };
  const pm = {
    due: pmDue.length,
    onTime: pmDue.filter((o) => onTime(o.dueRestoreAt, o.completedAt)).length,
  };

  // ---------------------------------------------------- availability --
  let criticalDowntime = 0;
  let otherDowntime = 0;
  for (const order of corrective) {
    if (order.band === "CRITICAL") criticalDowntime += downtime(order, now);
    else otherDowntime += downtime(order, now);
  }
  const periodDays = (startOf(to) - startOf(from)) / DAY_MS;
  const allowanceHours = Math.max(
    0,
    ((HOURS_PER_YEAR - contract.availabilityHoursYear) * periodDays) / 365,
  );
  const availabilityEur =
    Math.max(0, criticalDowntime - allowanceHours) * contract.availabilityPenaltyCriticalPerHour +
    Math.max(0, otherDowntime - allowanceHours) * contract.availabilityPenaltyOtherPerHour;

  // ------------------------------------------------------- penalties --
  let responseEur = 0;
  let restoreEur = 0;
  let pmEur = 0;
  for (const order of timed) {
    const respLate = lateHours(order.dueResponseAt, order.respondedAt, now);
    if (respLate > 0) {
      if (order.penaltyResponsePerHour === null) ratesMissing = true;
      else responseEur += respLate * order.penaltyResponsePerHour;
    }
    const restLate = lateHours(order.dueRestoreAt, order.restoredAt ?? order.completedAt, now);
    if (restLate > 0) {
      if (order.penaltyRestorePerHour === null) ratesMissing = true;
      else restoreEur += restLate * order.penaltyRestorePerHour;
    }
  }
  for (const order of pmDue) {
    const days = lateDays(order.dueRestoreAt, order.completedAt, now);
    if (days > 0) {
      if (order.penaltyPmPerDay === null) ratesMissing = true;
      else pmEur += days * order.penaltyPmPerDay;
    }
  }
  const totalEur = round2(pmEur) + round2(responseEur) + round2(restoreEur) + round2(availabilityEur);

  // ------------------------------------------------- repeat failures --
  const perAsset = new Map<string, number>();
  for (const order of corrective) {
    if (order.assetId) perAsset.set(order.assetId, (perAsset.get(order.assetId) ?? 0) + 1);
  }
  const repeatFailures = [...perAsset.values()].filter((n) => n >= 3).length;

  // --------------------------------------------------------- by band --
  const byBand = BANDS.map((band) => {
    const ofBand = timed.filter((o) => o.band === band);
    const resp = ofBand.filter((o) => o.dueResponseAt);
    const rest = ofBand.filter((o) => o.dueRestoreAt);
    return {
      band,
      corrective: corrective.filter((o) => o.band === band).length,
      responseOnTimePct: pct(
        resp.filter((o) => onTime(o.dueResponseAt, o.respondedAt)).length,
        resp.length,
      ),
      restoreOnTimePct: pct(
        rest.filter((o) => onTime(o.dueRestoreAt, o.restoredAt ?? o.completedAt)).length,
        rest.length,
      ),
      downtimeHours: round2(
        corrective.filter((o) => o.band === band).reduce((sum, o) => sum + downtime(o, now), 0),
      ),
    };
  });

  return {
    maintenanceContractId: contract.id,
    contractorName: contract.contractorName,
    contractRef: contract.ref,
    from: from.slice(0, 10),
    to: to.slice(0, 10),
    workOrders: {
      total: called.length,
      corrective: corrective.length,
      pm: called.filter((o) => o.kind === "PM").length,
      statutory: called.filter((o) => o.kind === "STATUTORY").length,
      open: called.filter((o) => o.status !== "COMPLETED").length,
    },
    response: { ...response, pct: pct(response.onTime, response.due) },
    restore: { ...restore, pct: pct(restore.onTime, restore.due) },
    report: { ...report, pct: pct(report.onTime, report.due) },
    pm: { ...pm, pct: pct(pm.onTime, pm.due) },
    availability: {
      criticalDowntimeHours: round2(criticalDowntime),
      otherDowntimeHours: round2(otherDowntime),
      allowanceHours: round2(allowanceHours),
      penaltyEur: round2(availabilityEur),
    },
    penalties: {
      pmEur: round2(pmEur),
      responseEur: round2(responseEur),
      restoreEur: round2(restoreEur),
      availabilityEur: round2(availabilityEur),
      totalEur: round2(totalEur),
      capUsedPct:
        contract.contractValue && contract.contractValue > 0
          ? round2((totalEur / contract.contractValue) * 100)
          : null,
      ratesMissing,
    },
    repeatFailures,
    byBand,
  };
}
