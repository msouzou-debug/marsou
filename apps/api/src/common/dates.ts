/**
 * Date sanity on the API side (owner request, 25/11/2026). The rules are the
 * shared lists next to each schema (`CONTRACT_DATE_RULES` and the rest, see
 * packages/shared/src/calendar-date.ts); this is the one place that turns a broken
 * rule into an answer.
 *
 * 400, like the rest of a body that is not valid: a date after today or an
 * end before its start is something typed wrong, not a state of the world
 * the caller could not have known about. The message is the rule's own
 * sentence (`errors.dateInFuture`, `errors.dateOrder`), or the one a caller
 * names for a pair whose default sentence would be about the wrong dates.
 *
 * A PATCH checks the record as it will be, not the body alone: a new
 * completion date has to be compared with the start date already stored.
 * The callers merge the two before they call this.
 */
import { type DateRule, type DateRules, dateIssues, nicosiaDateOf } from "@ecapital/shared";
import { AppError } from "./errors";

const KEYS: Record<DateRule, string> = {
  dateInFuture: "errors.dateInFuture",
  dateOrder: "errors.dateOrder",
};

export function assertDates<K extends string>(
  values: Partial<Record<K, unknown>>,
  rules: DateRules<K>,
  keys: Partial<Record<DateRule, string>> = {},
  today: string = nicosiaDateOf(),
): void {
  const [first] = dateIssues(values, rules, today);
  if (first) throw AppError.badRequest({ ...KEYS, ...keys }[first.rule]);
}

/** A stored value next to a sent one: the sent one when it was sent, null and all. */
export function merged<T>(sent: T | undefined, stored: T): T {
  return sent === undefined ? stored : sent;
}
