/**
 * The SLA clock of R09, as pure functions of a row.
 *
 * Kept out of the service so the thresholds can be unit-tested without a
 * database, and so the contract screen, the portfolio and the RFI list all
 * ask the same function rather than three implementations of it.
 */
import type { Rfi, SlaState } from "@ecapital/shared";
import { endOfNicosiaDay, nicosiaDateOf } from "@ecapital/shared";

const HOUR_MS = 3_600_000;

/**
 * RULE (R09): the band the SlaChip draws, computed on the server so a list
 * can be counted and sorted without the browser doing the arithmetic. It is
 * the same rule, threshold for threshold, as
 * `apps/web/src/components/sla-chip/SlaChip.tsx` `slaState()`:
 *
 *   more than half the SLA left  → GREEN
 *   half down to a tenth         → AMBER
 *   under a tenth, still to come → RED
 *   the moment has passed        → BREACHED
 *
 * Exactly half is AMBER and exactly a tenth is RED, because the boundaries
 * belong to the worse band — a clock that says GREEN at the halfway mark is a
 * clock nobody chases. A due date that has arrived is BREACHED, and so is an
 * SLA of no length at all, which is a division by zero dressed up as a
 * promise.
 *
 * RULE (R31, CAPEX-01 §1): a breach is a state and never a block. Nothing in
 * this file is consulted before a write.
 */
export function slaState(dueAt: Date | string, slaHours: number, at: Date): SlaState {
  const due = dueAt instanceof Date ? dueAt.getTime() : new Date(dueAt).getTime();
  const remainingMs = due - at.getTime();
  if (remainingMs <= 0) return "BREACHED";
  const totalMs = slaHours * HOUR_MS;
  if (!(totalMs > 0)) return "BREACHED";
  const remainingFraction = remainingMs / totalMs;
  if (remainingFraction > 0.5) return "GREEN";
  if (remainingFraction > 0.1) return "AMBER";
  return "RED";
}

/**
 * RULE (R09, ADR-0017): the clock stops when the question is answered. An RFI
 * answered with six hours to spare keeps the band it was answered in instead
 * of drifting to BREACHED while it waits to be closed — the SLA is a promise
 * about the answer, not about the paperwork after it.
 */
export function clockAt(
  answeredAt: Date | null,
  now: Date,
  stop: { answeredOn?: string | null; closedAt?: Date | null } = {},
): Date {
  if (answeredAt) {
    // Owner UAT 25/11/2026: the answer may be recorded days after it
    // arrived. The clock stops at the end of the day it arrived, or at the
    // moment it was recorded if that is earlier.
    if (stop.answeredOn) {
      const endOfDay = endOfNicosiaDay(stop.answeredOn);
      return endOfDay.getTime() < answeredAt.getTime() ? endOfDay : answeredAt;
    }
    return answeredAt;
  }
  // RULE (owner, UAT 25/11/2026): an RFI closed without an answer is no
  // longer waiting for one, so its clock stops at the close.
  return stop.closedAt ?? now;
}

/**
 * RULE (owner, UAT 25/11/2026): the day the answer arrived is not before
 * the day the RFI was raised. «Not after today» is the zod schema's.
 */
export function answeredOnBeforeRaised(raisedAt: Date, answeredOn: string): boolean {
  return answeredOn < nicosiaDateOf(raisedAt);
}

/** raisedAt + slaDays × 24h, and the length of that promise in hours. */
export function slaWindow(raisedAt: Date, slaDays: number): { dueAt: Date; hours: number } {
  const hours = slaDays * 24;
  return { dueAt: new Date(raisedAt.getTime() + hours * HOUR_MS), hours };
}

/**
 * UAT 25/11/2026: the due date an editor picks, as the SLA window it means.
 * A due date is a day, so the promise runs to the end of that day in Nicosia
 * — «by 30/11» means by the end of 30/11, not by the minute the RFI happened
 * to be raised. The window is counted from the raise, in whole hours rounded
 * up, and is never shorter than an hour (the CHECK in migration 0006).
 *
 * RULE (owner, UAT 25/11/2026): a due date is not before the day the RFI was
 * raised. That answer is null and the service refuses it with
 * errors.rfiDueBeforeRaised. The same day is allowed: an RFI raised at nine
 * and due by the end of the day is a promise someone can keep.
 */
export function dueWindowOn(raisedAt: Date, dueDate: string): { dueAt: Date; hours: number } | null {
  if (dueDate < nicosiaDateOf(raisedAt)) return null;
  const dueAt = endOfNicosiaDay(dueDate);
  const hours = Math.max(1, Math.ceil((dueAt.getTime() - raisedAt.getTime()) / HOUR_MS));
  return { dueAt, hours };
}

/**
 * Owner decision 25/11/2026: the day the RFI left by e-mail. RULE (owner,
 * UAT 25/11/2026, the site-log date rule): it is not before the day the RFI
 * was raised and not after today, both read as calendar days in Nicosia. On
 * a new RFI the day it was raised is today, so today is the only day it can
 * carry; an RFI recorded first and e-mailed later gets its day by an edit.
 * The zod schema already refuses a day after today (errors.dateInFuture);
 * this is the half only the row can answer.
 */
export function sentOnBeforeRaised(raisedAt: Date, sentOn: string | null | undefined): boolean {
  return typeof sentOn === "string" && sentOn < nicosiaDateOf(raisedAt);
}

/**
 * The type an RFI's evidence is filed under. An Outlook message saved to
 * disk is a `.msg`, which browsers send as `application/vnd.ms-outlook`, as
 * `application/octet-stream` or as nothing at all; a `.eml` arrives as
 * `message/rfc822` or as octet-stream too. Both are on eArchive's whitelist
 * under one name each, so the extension decides for these two and the
 * browser's (or the caller's) word decides for everything else — which the
 * store then holds to the whitelist (`errors.documentMimeRejected`).
 */
export function evidenceMime(filename: string, declared: string): string {
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(filename.trim())?.[1]?.toLowerCase();
  if (extension === "msg") return "application/vnd.ms-outlook";
  if (extension === "eml") return "message/rfc822";
  return declared.trim().toLowerCase();
}

export interface RfiRow {
  id: string;
  contractId: string;
  orgUnitId: string;
  number: number;
  questionEl: string;
  answerEl: string | null;
  raisedById: string;
  raisedByName: string | null;
  raisedAt: Date;
  answeredById: string | null;
  answeredByName: string | null;
  answeredAt: Date | null;
  slaDueAt: Date;
  slaHours: number;
  status: Rfi["status"];
  recipientName: string | null;
  recipientEmail: string | null;
  /** A `date` column: drizzle hands it back as yyyy-mm-dd. */
  sentOn: string | null;
  answeredOn: string | null;
  closedById: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  closingNote: string | null;
}

export function toRfi(row: RfiRow, now: Date): Rfi {
  return {
    id: row.id,
    contractId: row.contractId,
    orgUnitId: row.orgUnitId,
    number: row.number,
    questionEl: row.questionEl,
    answerEl: row.answerEl,
    raisedById: row.raisedById,
    raisedByName: row.raisedByName ?? "",
    raisedAt: row.raisedAt.toISOString(),
    answeredById: row.answeredById,
    answeredByName: row.answeredByName,
    answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    slaDueAt: row.slaDueAt.toISOString(),
    slaHours: row.slaHours,
    status: row.status,
    // Computed here and never stored (ADR-0017).
    slaState: slaState(
      row.slaDueAt,
      row.slaHours,
      clockAt(row.answeredAt, now, { answeredOn: row.answeredOn, closedAt: row.closedAt }),
    ),
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    sentOn: row.sentOn,
    // An answer recorded before 0032 has no day of its own: the day it was
    // typed in is the best there is.
    answeredOn: row.answeredOn ?? (row.answeredAt ? nicosiaDateOf(row.answeredAt) : null),
    closedById: row.closedById,
    closedByName: row.closedByName,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closingNote: row.closingNote,
  };
}
