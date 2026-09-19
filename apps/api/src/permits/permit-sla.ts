/**
 * The clock on an approval line (R22), which is the RFI's clock (R09,
 * ADR-0017) with a different length.
 *
 * `slaState` is imported from `../rfis/rfi-rows`, not copied: the SlaChip on
 * S14 draws permits and RFIs with the same thresholds, and two
 * implementations of «half the window gone» would drift inside a milestone.
 * What is new here is only how far away the due moment is.
 *
 * RULE (ASSUMPTION, ADR-0026): two **working** days. CAPEX-01 §6.4 gives the
 * route and says nothing about how long an approver has, and the contract in
 * `packages/shared/src/permit.ts` writes «2 working days, like an RFI's
 * default» on `PermitApproval.dueAt`. Working days, not calendar days,
 * because a permit submitted on Friday afternoon whose approvals are all RED
 * by Monday morning is a clock that teaches people to ignore it.
 *
 * Cyprus public holidays are not modelled. A holiday calendar is data
 * somebody has to maintain per year, it does not exist anywhere in this
 * repository, and guessing one would be worse than a clock that is a day
 * optimistic twice a year. ADR-0026 lists it as open.
 */
import type { SlaState } from "@ecapital/shared";
import { slaState } from "../rfis/rfi-rows";

export { slaState };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Saturday and Sunday. Everything else is a working day here. */
export function isWorkingDay(at: Date): boolean {
  const day = at.getUTCDay();
  return day !== 0 && day !== 6;
}

/**
 * `from` plus `days` working days, keeping the time of day.
 *
 * Counting starts at the next day: a line raised on Monday at 09:00 with two
 * working days is due Wednesday at 09:00, and one raised on Friday at 09:00
 * is due Tuesday. The weekend is skipped, never landed on.
 */
export function addWorkingDays(from: Date, days: number): Date {
  const at = new Date(from.getTime());
  let left = days;
  while (left > 0) {
    at.setTime(at.getTime() + DAY_MS);
    if (isWorkingDay(at)) left -= 1;
  }
  return at;
}

/** How long an approver has, by default. ASSUMPTION (ADR-0026). */
export const APPROVAL_SLA_WORKING_DAYS = 2;

/**
 * The due moment and the length of the promise, the two facts the row stores.
 * The band is computed on the way out and never written (ADR-0017).
 */
export function approvalSlaWindow(
  from: Date,
  workingDays: number = APPROVAL_SLA_WORKING_DAYS,
): { dueAt: Date; hours: number } {
  const dueAt = addWorkingDays(from, workingDays);
  return { dueAt, hours: Math.round((dueAt.getTime() - from.getTime()) / HOUR_MS) };
}

/**
 * RULE (ADR-0017): the clock stops when the decision is taken. A line
 * approved with six hours to spare keeps the band it was approved in instead
 * of drifting to BREACHED while the rest of the route catches up.
 */
export function approvalSlaState(
  dueAt: Date | string,
  slaHours: number,
  decidedAt: Date | null,
  now: Date,
): SlaState {
  return slaState(dueAt, slaHours, decidedAt ?? now);
}
