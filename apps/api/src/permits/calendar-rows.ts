/**
 * The arithmetic behind the disruption report (R25, CAPEX-01 §11), kept pure
 * so the months it splits across can be tested without a database.
 *
 * §11: «Clinical disruption: theatre and ICU hours lost to planned works, by
 * hospital and month.»
 */
import type { DisruptionHoursRow, PermitStatus } from "@ecapital/shared";

const HOUR_MS = 3_600_000;

/**
 * Which permits count as hours lost.
 *
 * A permit that was approved and then ran is a disruption whether it is still
 * running or has been closed. A draft is a thought, a submission is a request
 * and a permit still in clinical review has not been agreed to — none of the
 * three has taken a theatre off anybody yet, and counting them would put
 * hours in the report that never happened. A rejected one never will.
 */
export const DISRUPTION_STATUSES: PermitStatus[] = ["APPROVED", "ACTIVE", "BREACH", "CLOSED"];

export interface DisruptionPermit {
  permitId: string;
  orgUnitId: string;
  orgUnitNameEl: string;
  /** The real window where there is one, the planned window until then. */
  start: Date;
  end: Date;
  touchesTheatre: boolean;
  touchesIcu: boolean;
}

/**
 * RULE (§11): «by hospital and month», so a permit that runs from the 30th of
 * one month to the 2nd of the next is split between them. Attributing the
 * whole window to the month it started in would make a January report of a
 * December overrun, which is the kind of number nobody can reconcile.
 *
 * A permit touching both a theatre and an ICU counts in both columns —
 * they are two different losses, not one loss counted twice. `permits` counts
 * the permit once per month it ran in.
 */
export function disruptionRows(
  permits: DisruptionPermit[],
  year: number,
): DisruptionHoursRow[] {
  const byKey = new Map<string, DisruptionHoursRow>();

  for (const permit of permits) {
    for (const slice of monthSlices(permit.start, permit.end)) {
      if (slice.year !== year) continue;
      const month = `${slice.year}-${String(slice.month + 1).padStart(2, "0")}`;
      const key = `${permit.orgUnitId}:${month}`;
      const row =
        byKey.get(key) ??
        ({
          orgUnitId: permit.orgUnitId,
          orgUnitNameEl: permit.orgUnitNameEl,
          month,
          theatreHours: 0,
          icuHours: 0,
          permits: 0,
        } satisfies DisruptionHoursRow);
      if (permit.touchesTheatre) row.theatreHours = round2(row.theatreHours + slice.hours);
      if (permit.touchesIcu) row.icuHours = round2(row.icuHours + slice.hours);
      row.permits += 1;
      byKey.set(key, row);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.orgUnitNameEl.localeCompare(b.orgUnitNameEl, "el") || a.month.localeCompare(b.month),
  );
}

export interface MonthSlice {
  year: number;
  /** 0-based, as `Date.getUTCMonth()` gives it. */
  month: number;
  hours: number;
}

/** The window, cut at every UTC month boundary it crosses. */
export function monthSlices(start: Date, end: Date): MonthSlice[] {
  if (end.getTime() <= start.getTime()) return [];
  const slices: MonthSlice[] = [];
  let cursor = start;
  while (cursor.getTime() < end.getTime()) {
    const nextMonth = Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
    const until = Math.min(nextMonth, end.getTime());
    slices.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth(),
      hours: round2((until - cursor.getTime()) / HOUR_MS),
    });
    cursor = new Date(until);
  }
  return slices;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
