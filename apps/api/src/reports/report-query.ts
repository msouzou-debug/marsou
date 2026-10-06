/**
 * The query string every report route takes (ADR-0032 §1), as the shared
 * `ReportQuery` with the transport's spelling undone: Express hands the year
 * over as text, so it is coerced here and nowhere else.
 *
 * A report ignores the filters it does not take (`REPORT_CATALOGUE` says
 * which); what is checked here is that whatever was sent is well formed —
 * a real calendar date, a year inside the contract's range, a period that
 * runs forwards.
 */
import { ReportQuery } from "@ecapital/shared";
import { z } from "zod";
import { AppError } from "../common/errors";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const Params = z.object({
  orgUnitId: z.string().min(1).optional(),
  year: z.coerce.number().int().optional(),
  from: z.string().refine(realDate).optional(),
  to: z.string().refine(realDate).optional(),
  maintenanceContractId: z.string().min(1).optional(),
});

/** A parsed query with the year and the period already defaulted. */
export interface ResolvedQuery {
  orgUnitId: string | null;
  year: number;
  from: string;
  to: string;
}

/**
 * RULE (ADR-0032): a year defaults to this one; a period defaults to the
 * calendar quarter we are in, [first day, first day of the next). Where only
 * one end is sent the other comes from the quarter that end belongs to.
 * `from` on or after `to` is a period that runs backwards: 400.
 */
export function parseReportQuery(raw: unknown, now: Date): ResolvedQuery {
  const input = (raw ?? {}) as Record<string, unknown>;
  // An empty `?year=` is "no year", not year zero; a repeated key is not a filter.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === "" || value === undefined) continue;
    if (Array.isArray(value)) throw AppError.badRequest("errors.reportQueryNotValid");
    cleaned[key] = value;
  }
  const parsed = Params.safeParse(cleaned);
  if (!parsed.success) throw AppError.badRequest("errors.reportQueryNotValid");
  const shared = ReportQuery.safeParse(parsed.data);
  if (!shared.success) throw AppError.badRequest("errors.reportQueryNotValid");
  const query = shared.data;

  const year = query.year ?? now.getUTCFullYear();
  let { from, to } = query;
  if (!from && !to) ({ from, to } = quarterOf(now.toISOString().slice(0, 10)));
  else if (from && !to) to = quarterOf(from).to;
  else if (!from && to) from = quarterOf(addDays(to, -1)).from;
  if (!from || !to || from >= to) throw AppError.badRequest("errors.reportQueryNotValid");

  return { orgUnitId: query.orgUnitId ?? null, year, from, to };
}

/** The calendar quarter an ISO date falls in, as [from, to). */
export function quarterOf(isoDate: string): { from: string; to: string } {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7)) - 1;
  const first = Math.floor(month / 3) * 3;
  const from = new Date(Date.UTC(year, first, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, first + 3, 1)).toISOString().slice(0, 10);
  return { from, to };
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
