import { z } from "zod";

// Calendar dates as a Cypriot clerk writes them, and the owner's date-sanity
// rule (UAT 25/11/2026) for the site log: a date that records something that
// has already happened — raised, issued, received, answered, found, closed —
// is not after today, and a due date is not before the day the record was
// raised or issued. Today means today in Europe/Nicosia, not in UTC: at 01:30
// on 1 March in Nicosia it is still 28 February in London.

const NICOSIA = "Europe/Nicosia";

/** The calendar day an instant falls on in Europe/Nicosia, as yyyy-mm-dd. */
export function nicosiaDateOf(at: Date | string = new Date()): string {
  const instant = at instanceof Date ? at : new Date(at);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NICOSIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** yyyy-mm-dd that names a real day (no 31 April). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole calendar days from `from` to `to` (both yyyy-mm-dd); negative when `to` is earlier. */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** How far Europe/Nicosia's wall clock is ahead of UTC at an instant, in ms. */
function nicosiaOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NICOSIA,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const wallClock = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return wallClock - (at - (at % 1000));
}

/** Midnight at the start of a Nicosia calendar day, as an instant. */
export function startOfNicosiaDay(date: string): Date {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // Twice, so the offset is the one in force at local midnight itself; Cyprus
  // changes its clocks at 03:00/04:00, never across midnight.
  const first = utcMidnight - nicosiaOffsetMs(utcMidnight);
  return new Date(utcMidnight - nicosiaOffsetMs(first));
}

/** The last millisecond of a Nicosia calendar day, as an instant. */
export function endOfNicosiaDay(date: string): Date {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return new Date(startOfNicosiaDay(next.toISOString().slice(0, 10)).getTime() - 1);
}

/** The refine message the API and the forms both use for a day still to come. */
export const DATE_IN_FUTURE = "dateInFuture";

export const CalendarDate = z.string().refine(isCalendarDate, "invalidDate");

/**
 * RULE (owner, UAT 25/11/2026): a date that records something that already
 * happened is today or earlier. Checked against the clock at the moment of
 * parsing, so it is never stale.
 */
export const PastOrTodayDate = CalendarDate.refine(
  (value) => value <= nicosiaDateOf(new Date()),
  DATE_IN_FUTURE,
);

/** True when every issue in a zod failure is the "not after today" rule. */
export function isOnlyFutureDateIssue(error: z.ZodError): boolean {
  return error.issues.length > 0 && error.issues.every((issue) => issue.message === DATE_IN_FUTURE);
}
