/**
 * M5 — the maintenance rules that are arithmetic, not data (ADR-0031).
 *
 * Pure functions over ISO strings: no database, no clock of their own. The
 * service hands in `now`, so a test can stand anywhere in time and the
 * hourly sweep, «Έκδοση τώρα» and a read all agree on what a deadline is.
 *
 * The contract's own rules (slaStateOf, addHours, nextDueAfter, the
 * transitions) live in packages/shared/src/maintenance.ts and are used from
 * there, never restated here. What is here is what only the server needs:
 * Nicosia wall-clock time, working days for an extension, the PM deadlines,
 * the timers on a stored order and R36's replacement rule.
 */
import {
  BACKLOG_REPAIR_COST_PCT,
  BACKLOG_REPEAT_COUNT,
  type BacklogAutoReason,
  type RiskBand,
  type WorkOrderSla,
  slaStateOf,
} from "@ecapital/shared";
import { moneyInText } from "../documents/earchive-contract";

/** Every unit in the estate is on the island's clock (org_unit.timezone). */
export const NICOSIA = "Europe/Nicosia";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: NICOSIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
  hourCycle: "h23",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export interface LocalParts {
  /** YYYY-MM-DD on the Nicosia calendar. */
  date: string;
  /** HH:MM:SS on the Nicosia clock. */
  time: string;
  /** 0 = Sunday … 6 = Saturday, in Nicosia. */
  weekday: number;
}

/** What the clock on the wall in Nicosia read at this instant. */
export function nicosiaParts(at: string | Date): LocalParts {
  const instant = typeof at === "string" ? new Date(at) : at;
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Today's date in Nicosia — the PM programme is written in Nicosia days. */
export function todayInNicosia(now: Date): string {
  return nicosiaParts(now).date;
}

/** The Nicosia calendar year, which is the year in a work order's reference. */
export function nicosiaYear(at: string | Date): number {
  return Number(nicosiaParts(at).date.slice(0, 4));
}

/**
 * The UTC instant a Nicosia wall-clock reading names. Two passes, because
 * the offset is the offset *at the answer*, which is the thing being looked
 * for: the first pass guesses with the offset at the naive instant, the
 * second corrects it on the two nights a year the clocks move.
 */
export function fromNicosiaLocal(date: string, time: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const [hh, mm, ss] = `${time}:00:00`.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  let guess = naive;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = nicosiaParts(new Date(guess));
    const [sy, sm, sd] = seen.date.split("-").map(Number);
    const [sh, smin, ssec] = seen.time.split(":").map(Number);
    const seenAsUtc = Date.UTC(sy, sm - 1, sd, sh, smin, ssec);
    guess -= seenAsUtc - naive;
  }
  return new Date(guess).toISOString();
}

/** 23:59 Nicosia on a date: the programme date's deadline (ADR-0031 §3). */
export function endOfDayNicosia(date: string): string {
  return fromNicosiaLocal(date, "23:59:00");
}

/** A date plus whole calendar days, dates only. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Contract note 2: an imported spare extends the restore time by working
 * days. Monday to Friday on the Nicosia calendar, at the same wall-clock time
 * as the deadline it extends — five working days from a Thursday 14:00 is the
 * Thursday after, 14:00, whatever the clocks did in between.
 *
 * Public holidays are not counted out. The contract says «εργάσιμες» and the
 * owner has not given a holiday calendar; a missed holiday makes the deadline
 * a day early, which is the side the coordinator can grant again (FLAG,
 * ADR-0031).
 */
export function addWorkingDays(iso: string, days: number): string {
  if (days <= 0) return new Date(iso).toISOString();
  const local = nicosiaParts(iso);
  let date = local.date;
  let left = days;
  while (left > 0) {
    date = addDays(date, 1);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return fromNicosiaLocal(date, local.time);
}

/**
 * A PM order's two deadlines from its programme date: the visit by 23:59 on
 * the day, and the written report within one week of it (contract: «εντός
 * μίας εβδομάδας»).
 */
export function pmDeadlines(dueDate: string): { dueRestoreAt: string; dueReportAt: string } {
  return {
    dueRestoreAt: endOfDayNicosia(dueDate),
    dueReportAt: endOfDayNicosia(addDays(dueDate, 7)),
  };
}

// ------------------------------------------------------------ timers --

export interface TimerFacts {
  kind: "CORRECTIVE" | "PM" | "STATUTORY";
  status: string;
  calledAt: string;
  dueResponseAt: string | null;
  dueRestoreAt: string | null;
  dueReportAt: string | null;
  respondedAt: string | null;
  restoredAt: string | null;
  completedAt: string | null;
  reportReceivedAt: string | null;
  cancelledAt: string | null;
}

function hoursBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  return (Date.parse(to) - Date.parse(from)) / HOUR_MS;
}

/**
 * The three chips on an order, computed on read with the contract's own
 * `slaStateOf`. The length of each timer is the distance from the call to
 * its deadline, so the AMBER quarter of a two-hour restore is the last thirty
 * minutes and that of an extended one moves with it.
 *
 * A PM order has one deadline, its programme date, in the restore slot, met
 * when the order completes. A cancelled order has no clocks: a call that was
 * withdrawn cannot be late.
 */
export function workOrderSla(order: TimerFacts, now: string): WorkOrderSla {
  if (order.status === "CANCELLED") return { response: null, restore: null, report: null };
  if (order.kind === "PM") {
    return {
      response: null,
      restore: slaStateOf(
        order.dueRestoreAt,
        order.completedAt,
        now,
        hoursBetween(order.calledAt, order.dueRestoreAt),
      ),
      report: null,
    };
  }
  return {
    response: slaStateOf(
      order.dueResponseAt,
      order.respondedAt,
      now,
      hoursBetween(order.calledAt, order.dueResponseAt),
    ),
    restore: slaStateOf(
      order.dueRestoreAt,
      order.restoredAt ?? order.completedAt,
      now,
      hoursBetween(order.calledAt, order.dueRestoreAt),
    ),
    report: slaStateOf(
      order.dueReportAt,
      order.reportReceivedAt,
      now,
      hoursBetween(order.calledAt, order.dueReportAt),
    ),
  };
}

/**
 * Hours the system was down: from the call to the restore (or the close, or
 * the withdrawal), or to now while it is still down. Corrective only — a PM
 * visit is not an outage.
 */
export function downtimeHours(order: TimerFacts, now: string): number | null {
  if (order.kind !== "CORRECTIVE") return null;
  const end = order.restoredAt ?? order.completedAt ?? order.cancelledAt ?? now;
  return Math.max(0, round2((Date.parse(end) - Date.parse(order.calledAt)) / HOUR_MS));
}

// ---------------------------------------------------------- R36 rule --

export interface RepairHistoryLine {
  ref: string;
  calledAt: string;
  /** What the repair cost: the actual figure, else the estimate, else nothing. */
  cost: number | null;
}

/**
 * R36, ADR-0031 §8: three or more corrective orders on one asset inside
 * twelve months, or repair cost in those months above
 * BACKLOG_REPAIR_COST_PCT of the asset's replacement estimate. The count is
 * checked first because it needs no estimate; the cost rule is silent on an
 * asset nobody has priced.
 */
export function replacementRule(
  history: RepairHistoryLine[],
  replacementCostEst: number | null,
): BacklogAutoReason | null {
  if (history.length >= BACKLOG_REPEAT_COUNT) return "THREE_CORRECTIVE_IN_12_MONTHS";
  if (replacementCostEst && replacementCostEst > 0) {
    const spent = history.reduce((sum, line) => sum + (line.cost ?? 0), 0);
    if (spent > (replacementCostEst * BACKLOG_REPAIR_COST_PCT) / 100) {
      return "REPAIR_COST_OVER_THRESHOLD";
    }
  }
  return null;
}

/** dd/mm/yyyy on the Nicosia calendar, the way a Greek reader writes a date. */
export function dateEl(iso: string): string {
  const [y, m, d] = nicosiaParts(iso).date.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * The history the auto-draft attaches: one line per order, oldest first —
 * reference, date of the call and cost — and the sum, so whoever reads the
 * item sees why it exists without opening four orders.
 */
export function historyText(history: RepairHistoryLine[]): string {
  const lines = [...history]
    .sort((a, b) => Date.parse(a.calledAt) - Date.parse(b.calledAt))
    .map(
      (line) =>
        `${line.ref}, ${dateEl(line.calledAt)}, ${line.cost === null ? "χωρίς κόστος" : moneyInText(line.cost)}`,
    );
  const total = history.reduce((sum, line) => sum + (line.cost ?? 0), 0);
  return [...lines, `Σύνολο επισκευών: ${moneyInText(total)}`].join("\n");
}

/**
 * The band an auto-drafted replacement starts in, from the asset's
 * criticality (Maximo 1–5, CAPEX-01 §2). A life-critical machine failing
 * three times is a HIGH item until somebody says otherwise; the engineer
 * re-bands it on the backlog screen.
 */
export function riskBandForCriticality(criticality: number | null): RiskBand {
  if (criticality === 1) return "HIGH";
  if (criticality === 2) return "SIGNIFICANT";
  if (criticality === 3) return "MODERATE";
  return "LOW";
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS;
}
