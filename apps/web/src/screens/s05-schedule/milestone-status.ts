// S05 — R06 (Milestones with baseline vs forecast vs actual)
//
// Pure helpers for the schedule table and timeline: the day-count between
// two ISO dates, the derived Κατάσταση, and a loose ISO-date check for the
// inline editor's typed value. Kept apart from the components so the
// business rules are unit-tested without rendering anything
// (CONVENTIONS.md "Name.test.tsx covers the business rules, not the
// styling").
import type { Milestone } from "@ecapital/shared";

export type MilestoneStatus = "PENDING" | "DELAYED" | "DONE";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` is a plain `YYYY-MM-DD` string that is also a real date
 *  (rejects e.g. "2026-02-30"). Empty string is not a valid date — the
 *  caller decides separately whether "clear the field" (empty) is allowed. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** `a` − `b`, in whole days. Both are ISO dates (`YYYY-MM-DD`). */
export function daysBetween(a: string, b: string): number {
  const start = new Date(`${b}T00:00:00Z`).getTime();
  const end = new Date(`${a}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

/**
 * Απόκλιση: forecast − baseline, in days. `null` when there is no forecast
 * yet. RULE (build brief): the deviation is marked red only when it is
 * positive — the forecast has slipped past the baseline; a forecast that is
 * early (negative) or on the baseline (zero) is not a problem.
 */
export function deviationDays(milestone: Milestone): number | null {
  return milestone.forecastDate ? daysBetween(milestone.forecastDate, milestone.baselineDate) : null;
}

/**
 * RULE (build brief): Εκκρεμεί / Σε καθυστέρηση / Ολοκληρώθηκε, derived from
 * the dates alone. An actual date closes the milestone regardless of the
 * deviation; short of that, a positive deviation reads as "Σε καθυστέρηση".
 */
export function milestoneStatus(milestone: Milestone): MilestoneStatus {
  if (milestone.actualDate) return "DONE";
  const deviation = deviationDays(milestone);
  return deviation !== null && deviation > 0 ? "DELAYED" : "PENDING";
}
