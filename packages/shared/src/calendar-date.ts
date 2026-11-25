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

// ------------------------------------------------------- the date rules --
// The same owner rule (UAT 25/11/2026) across the rest of eCapital, stated
// as two rules and applied by the web form (a zod `superRefine`, message
// under the field) and by the API (before a write) from the same rule lists,
// which live next to each schema they guard (`CONTRACT_DATE_RULES`,
// `PROJECT_DATE_RULES` and the rest):
//
// 1. «Happened» — a date that records something that already took place
//    (notified, received, approved, signed, issued, handed over, paid,
//    activated, an actual date) cannot be after today in Nicosia.
// 2. «Ordered» — an end cannot be before its own start (completion vs start,
//    period to vs from, agreement end vs start). Either side may be missing;
//    a missing date breaks nothing.
//
// Planned and forecast dates are free to be in the future and appear in no
// list. A rule that is not in a list is not enforced anywhere: the lists are
// the whole policy, which is why each one carries a comment saying what it
// covers. The rule names are the i18n keys' last segment, so «happened» is
// `DATE_IN_FUTURE` above (`forms.dateInFuture`, `errors.dateInFuture`).

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const ZONED_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * The calendar day a value names, in Nicosia. A plain date is itself; an
 * instant with `Z` or an offset is moved to Nicosia first; a naive date-time
 * (what `<input type="datetime-local">` reports) is already local. Anything
 * else is null: not a date this helper can judge, and so not one it refuses.
 */
export function nicosiaDayOf(value: string): string | null {
  if (DATE_ONLY.test(value)) return value;
  if (NAIVE_DATETIME.test(value)) return value.slice(0, 10);
  if (ZONED_DATETIME.test(value)) {
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? null : nicosiaDateOf(at);
  }
  return null;
}

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Rule 1. True when there is no date, or when the day it names is today or
 * earlier in Nicosia. `today` is injectable for tests and for a caller that
 * has already worked it out once for a whole request.
 */
export function notAfterToday(value: string | null | undefined, today: string = nicosiaDateOf()): boolean {
  if (!present(value)) return true;
  const day = nicosiaDayOf(value.trim());
  return day === null || day <= today;
}

/**
 * Rule 2. True when either side is missing, or when `end` is not before
 * `start`. Two instants (both zoned) compare as instants, two naive
 * date-times as the local clock they both read; anything else — a date
 * against a date, or a date against a date-time — compares as Nicosia days,
 * so a finish on the same day as its start is never «before» it.
 */
export function notBefore(end: string | null | undefined, start: string | null | undefined): boolean {
  if (!present(end) || !present(start)) return true;
  const e = end.trim();
  const s = start.trim();
  if (ZONED_DATETIME.test(e) && ZONED_DATETIME.test(s)) {
    const a = Date.parse(e);
    const b = Date.parse(s);
    return Number.isNaN(a) || Number.isNaN(b) || a >= b;
  }
  if (NAIVE_DATETIME.test(e) && NAIVE_DATETIME.test(s)) return e >= s;
  const endDay = nicosiaDayOf(e);
  const startDay = nicosiaDayOf(s);
  return endDay === null || startDay === null || endDay >= startDay;
}

/** Which rule a value broke. The web prefixes `forms.`, the API `errors.`. */
export type DateRule = "dateInFuture" | "dateOrder";

/**
 * The rules for one shape. `happened` lists the fields rule 1 applies to;
 * `ordered` lists `[start, end]` pairs for rule 2, and an issue is reported
 * against the `end` field, which is the one a person fixes.
 */
export interface DateRules<K extends string = string> {
  happened?: readonly K[];
  ordered?: readonly (readonly [K, K])[];
}

export interface DateIssue<K extends string = string> {
  field: K;
  rule: DateRule;
}

/** Every rule `values` breaks, in the order the lists give them. */
export function dateIssues<K extends string>(
  values: Partial<Record<K, unknown>>,
  rules: DateRules<K>,
  today: string = nicosiaDateOf(),
): DateIssue<K>[] {
  const issues: DateIssue<K>[] = [];
  for (const field of rules.happened ?? []) {
    const value = values[field];
    if (typeof value === "string" && !notAfterToday(value, today)) issues.push({ field, rule: "dateInFuture" });
  }
  for (const [start, end] of rules.ordered ?? []) {
    const s = values[start];
    const e = values[end];
    if (typeof s === "string" && typeof e === "string" && !notBefore(e, s)) issues.push({ field: end, rule: "dateOrder" });
  }
  return issues;
}

/** The i18n key each rule shows under a web form field. */
export const DATE_RULE_FORM_MESSAGES: Record<DateRule, string> = {
  dateInFuture: "forms.dateInFuture",
  dateOrder: "forms.dateOrder",
};

/**
 * The same rules as a zod `superRefine` callback for a web form: one issue
 * per broken rule, under the field, with an i18n key as the message (see
 * `apps/web/src/lib/zod-resolver.ts`). `messages` overrides a key where the
 * default sentence would name the wrong pair of dates.
 */
export function refineDates<K extends string>(
  rules: DateRules<K>,
  messages: Partial<Record<DateRule, string>> = {},
  today: () => string = () => nicosiaDateOf(),
) {
  return (values: unknown, ctx: z.RefinementCtx): void => {
    const keyed = { ...DATE_RULE_FORM_MESSAGES, ...messages };
    for (const issue of dateIssues(values as Partial<Record<K, unknown>>, rules, today())) {
      ctx.addIssue({ code: "custom", message: keyed[issue.rule], path: [issue.field] });
    }
  };
}
