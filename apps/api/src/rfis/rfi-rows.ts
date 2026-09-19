/**
 * The SLA clock of R09, as pure functions of a row.
 *
 * Kept out of the service so the thresholds can be unit-tested without a
 * database, and so the contract screen, the portfolio and the RFI list all
 * ask the same function rather than three implementations of it.
 */
import type { Rfi, SlaState } from "@ecapital/shared";

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
export function clockAt(answeredAt: Date | null, now: Date): Date {
  return answeredAt ?? now;
}

/** raisedAt + slaDays × 24h, and the length of that promise in hours. */
export function slaWindow(raisedAt: Date, slaDays: number): { dueAt: Date; hours: number } {
  const hours = slaDays * 24;
  return { dueAt: new Date(raisedAt.getTime() + hours * HOUR_MS), hours };
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
    slaState: slaState(row.slaDueAt, row.slaHours, clockAt(row.answeredAt, now)),
  };
}
