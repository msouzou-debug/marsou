import { Injectable } from "@nestjs/common";
import type { Rfi, RfiAnswer, RfiCreate } from "@ecapital/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, CHECK_VIOLATION, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { type RfiRow, slaWindow, toRfi } from "./rfi-rows";

/**
 * M1 — the RFI log (R09). Αίτημα διευκρίνισης: a question about the works,
 * with a promise about when it will be answered.
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010). An RFI on a contract in a unit the caller may not see does not
 * exist for them: the select returns nothing and the answer is 404. A write
 * they may not make is refused by the policy, and the 42501 that comes back
 * becomes a 403.
 *
 * RULE (R09, CAPEX-01 §1): the SLA is a clock, not a gate. A breached RFI can
 * still be answered, still be closed, and still be reported on. Nothing in
 * this file asks the band before it writes.
 */
@Injectable()
export class RfisService {
  /** Newest first: the RFI people are looking at is the one just raised. */
  async list(contractId: string, now: Date): Promise<Rfi[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);

    const rows = await tx.db
      .select(RFI_COLUMNS)
      .from(schema.rfi)
      .where(eq(schema.rfi.contractId, contractId))
      .orderBy(desc(schema.rfi.number));
    return rows.map((row) => toRfi(row as RfiRow, now));
  }

  /**
   * RULE (R09): `slaDueAt` is raisedAt + slaDays × 24h and `slaHours` is
   * slaDays × 24, worked out here and never sent by a caller — an SLA a
   * client could type is an SLA nobody keeps. The number comes from
   * ecapital.allocate_rfi_number, which holds an advisory lock on the
   * contract for the length of this transaction, so two engineers raising one
   * in the same second get 4 and 5 rather than two fours (ADR-0015).
   */
  async create(contractId: string, input: RfiCreate, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const caller = await callerUserId();
    const { dueAt, hours } = slaWindow(now, input.slaDays);

    try {
      const [{ number }] = await tx.db
        .select({ number: sql<number>`ecapital.allocate_rfi_number(${contractId}::uuid)` })
        .from(sql`(select 1) as one`);

      const [row] = await tx.db
        .insert(schema.rfi)
        .values({
          contractId,
          // The trigger overwrites this from the contract; it is here because
          // the column is NOT NULL.
          orgUnitId: "",
          number,
          questionEl: input.questionEl,
          raisedBy: caller,
          raisedAt: now,
          slaDueAt: dueAt,
          slaHours: hours,
          status: "OPEN",
        })
        .returning({ id: schema.rfi.id });
      return await this.one(contractId, row.id, now);
    } catch (error) {
      this.writeError(error);
    }
  }

  /**
   * RULE (CAPEX-01 §1, ADR-0017): the answerer may be the raiser. An RFI is a
   * question put to the ΟΚΥπΥ side, and it is ΟΚΥπΥ staff who attach the
   * designer's or the contractor's correspondence to it. There is deliberately
   * no segregation rule here — the variation has one because a variation moves
   * money, and answering a question does not.
   *
   * RULE (R09): an RFI is answered once. A second answer would overwrite a
   * piece of correspondence, which is what a new RFI is for.
   */
  async answer(contractId: string, rfiId: string, input: RfiAnswer, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const existing = await this.row(contractId, rfiId);
    if (existing.status !== "OPEN") throw AppError.unprocessable("errors.rfiNotOpen");

    const caller = await callerUserId();
    try {
      const touched = await tx.db
        .update(schema.rfi)
        .set({
          answerEl: input.answerEl,
          answeredBy: caller,
          answeredAt: now,
          status: "ANSWERED",
          updatedAt: sql`now()`,
        })
        .where(eq(schema.rfi.id, rfiId))
        .returning({ id: schema.rfi.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }
    return this.one(contractId, rfiId, now);
  }

  /**
   * RULE (R09): ANSWERED → CLOSED, and closing an unanswered RFI is refused
   * with errors.rfiNotAnswered. Closing is what says the answer was good
   * enough, so there has to be one to be good enough. The CHECK constraint in
   * migration 0006 says the same thing to every other code path (ADR-0017).
   */
  async close(contractId: string, rfiId: string, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const existing = await this.row(contractId, rfiId);
    if (existing.status === "OPEN") throw AppError.unprocessable("errors.rfiNotAnswered");
    if (existing.status === "CLOSED") throw AppError.unprocessable("errors.rfiAlreadyClosed");

    try {
      const touched = await tx.db
        .update(schema.rfi)
        .set({ status: "CLOSED", updatedAt: sql`now()` })
        .where(eq(schema.rfi.id, rfiId))
        .returning({ id: schema.rfi.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }
    return this.one(contractId, rfiId, now);
  }

  // ------------------------------------------------------------- internals --

  private async one(contractId: string, rfiId: string, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select(RFI_COLUMNS)
      .from(schema.rfi)
      .where(and(eq(schema.rfi.id, rfiId), eq(schema.rfi.contractId, contractId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.rfiNotFound");
    return toRfi(rows[0] as RfiRow, now);
  }

  private async row(
    contractId: string,
    rfiId: string,
  ): Promise<{ id: string; status: Rfi["status"] }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(rfiId)) throw AppError.notFound("errors.rfiNotFound");
    const rows = await tx.db
      .select({ id: schema.rfi.id, status: schema.rfi.status })
      .from(schema.rfi)
      .where(and(eq(schema.rfi.id, rfiId), eq(schema.rfi.contractId, contractId)))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.rfiNotFound");
    return rows[0];
  }

  /** A contract the caller may not read is a contract that does not exist. */
  private async contractOf(contractId: string): Promise<{ id: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(contractId)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
    return rows[0];
  }

  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    // The only CHECKs a caller can reach here are the answer and close rules
    // above, and reaching one means the service rule was bypassed somehow.
    if (state === CHECK_VIOLATION) throw AppError.unprocessable("errors.rfiNotAnswered");
    throw error;
  }
}

const RFI_COLUMNS = {
  id: schema.rfi.id,
  contractId: schema.rfi.contractId,
  orgUnitId: schema.rfi.orgUnitId,
  number: schema.rfi.number,
  questionEl: schema.rfi.questionEl,
  answerEl: schema.rfi.answerEl,
  raisedById: schema.rfi.raisedBy,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.rfi.raisedBy})`,
  raisedAt: schema.rfi.raisedAt,
  answeredById: schema.rfi.answeredBy,
  answeredByName: sql<string | null>`ecapital.user_display_name(${schema.rfi.answeredBy})`,
  answeredAt: schema.rfi.answeredAt,
  slaDueAt: schema.rfi.slaDueAt,
  slaHours: schema.rfi.slaHours,
  status: schema.rfi.status,
};
