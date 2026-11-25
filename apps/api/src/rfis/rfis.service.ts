import { Injectable } from "@nestjs/common";
import type { Rfi, RfiAnswer, RfiClose, RfiCreate, RfiDocument, RfiUpdate } from "@ecapital/shared";
import { nicosiaDateOf } from "@ecapital/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  INSUFFICIENT_PRIVILEGE,
  CHECK_VIOLATION,
  constraintName,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DocumentsService, type UploadInput } from "../documents/documents.service";
import {
  type RfiRow,
  answeredOnBeforeRaised,
  dueWindowOn,
  sentOnBeforeRaised,
  slaWindow,
  toRfi,
} from "./rfi-rows";

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
  constructor(private readonly files: DocumentsService) {}

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
    // RULE (owner, UAT 25/11/2026): sent not before the day it was raised,
    // and it is being raised now — so on a new RFI the sent day is today.
    if (sentOnBeforeRaised(now, input.sentOn)) {
      throw AppError.unprocessable("errors.rfiSentBeforeRaised");
    }

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
          recipientName: input.recipientName.trim(),
          recipientEmail: input.recipientEmail?.trim() || null,
          sentOn: input.sentOn ?? null,
        })
        .returning({ id: schema.rfi.id });
      return await this.one(contractId, row.id, now);
    } catch (error) {
      this.writeError(error);
    }
  }

  /**
   * UAT 25/11/2026: correcting an RFI — its question and its due date — for
   * as long as it is not closed. Who raised it and when, and the answer, are
   * not changed here: the first two are the record, the answer has its own
   * route. The audit trigger on ecapital.rfi (migration 0006) keeps the old
   * and new values of every change, like every other write on the table.
   *
   * RULE (UAT 25/11/2026): a CLOSED RFI is settled correspondence and is not
   * edited — 422 errors.rfiClosedNoEdit. A new question is a new RFI.
   *
   * RULE (owner, UAT 25/11/2026): the due date is not before the day the RFI
   * was raised — 422 errors.rfiDueBeforeRaised. A due date the caller sends
   * unchanged is left alone, so saving the question does not move the clock.
   */
  async update(
    contractId: string,
    rfiId: string,
    input: Partial<RfiUpdate>,
    now: Date,
  ): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    await this.row(contractId, rfiId);
    const existing = await this.one(contractId, rfiId, now);
    if (existing.status === "CLOSED") throw AppError.unprocessable("errors.rfiClosedNoEdit");

    const values: {
      questionEl?: string;
      slaDueAt?: Date;
      slaHours?: number;
      recipientName?: string;
      recipientEmail?: string | null;
      sentOn?: string | null;
    } = {};
    if (input.questionEl !== undefined && input.questionEl !== existing.questionEl) {
      values.questionEl = input.questionEl;
    }
    if (input.dueDate !== undefined && input.dueDate !== nicosiaDateOf(existing.slaDueAt)) {
      const window = dueWindowOn(new Date(existing.raisedAt), input.dueDate);
      if (!window) throw AppError.unprocessable("errors.rfiDueBeforeRaised");
      values.slaDueAt = window.dueAt;
      values.slaHours = window.hours;
    }
    // Owner decision 25/11/2026: who it went to and when it left. A value
    // sent unchanged is left alone, so saving the form writes no audit line
    // for a field nobody touched.
    if (input.recipientName !== undefined) {
      const name = input.recipientName.trim();
      if (name !== existing.recipientName) values.recipientName = name;
    }
    if (input.recipientEmail !== undefined) {
      const email = input.recipientEmail?.trim() || null;
      if (email !== existing.recipientEmail) values.recipientEmail = email;
    }
    if (input.sentOn !== undefined && input.sentOn !== existing.sentOn) {
      if (sentOnBeforeRaised(new Date(existing.raisedAt), input.sentOn)) {
        throw AppError.unprocessable("errors.rfiSentBeforeRaised");
      }
      values.sentOn = input.sentOn;
    }
    if (Object.keys(values).length === 0) return existing;

    try {
      const touched = await tx.db
        .update(schema.rfi)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.rfi.id, rfiId))
        .returning({ id: schema.rfi.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }
    return this.one(contractId, rfiId, now);
  }

  /**
   * RULE (CAPEX-01 §1, ADR-0017): the answerer may be the raiser. An RFI is a
   * question put to the ΟΚΥπΥ side, and it is ΟΚΥπΥ staff who attach the
   * designer's or the contractor's correspondence to it. There is deliberately
   * no segregation rule here — the variation has one because a variation moves
   * money, and answering a question does not.
   *
   * RULE (R09): an RFI is answered once, and only while it is open. A second
   * answer would overwrite a piece of correspondence, which is what a new RFI
   * is for; a closed RFI is settled.
   *
   * RULE (owner, UAT 25/11/2026): the day the answer arrived is recorded with
   * it — today when the caller does not say, never after today (the zod
   * schema) and never before the day the RFI was raised
   * (errors.rfiAnsweredBeforeRaised). `answered_at` stays the moment it was
   * typed in: that is the record of who did what when.
   */
  async answer(contractId: string, rfiId: string, input: RfiAnswer, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const existing = await this.row(contractId, rfiId);
    if (existing.status === "CLOSED") throw AppError.unprocessable("errors.rfiAlreadyClosed");
    if (existing.status !== "OPEN") throw AppError.unprocessable("errors.rfiNotOpen");
    const answeredOn = input.answeredOn ?? nicosiaDateOf(now);
    if (answeredOnBeforeRaised(existing.raisedAt, answeredOn)) {
      throw AppError.unprocessable("errors.rfiAnsweredBeforeRaised");
    }

    const caller = await callerUserId();
    try {
      const touched = await tx.db
        .update(schema.rfi)
        .set({
          answerEl: input.answerEl,
          answeredBy: caller,
          answeredAt: now,
          answeredOn,
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
   * RULE (owner, UAT 25/11/2026, replacing R09's «answered before closed»):
   * an RFI closes with or without an answer. A question can stop mattering —
   * settled on site, overtaken by a drawing revision — and waiting for an
   * answer nobody will send kept it open for ever. What closes it then is a
   * reason: the closing note is optional on an answered RFI and required on
   * an unanswered one (errors.rfiCloseNoteNeeded). The CHECK
   * `rfi_closed_answer_or_note` (0032) says the same to every code path.
   * Who closed it and when are recorded; a closed RFI is not edited.
   */
  async close(contractId: string, rfiId: string, input: RfiClose, now: Date): Promise<Rfi> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const existing = await this.row(contractId, rfiId);
    if (existing.status === "CLOSED") throw AppError.unprocessable("errors.rfiAlreadyClosed");
    const note = input.closingNote?.trim() || null;
    if (existing.status === "OPEN" && !note) {
      throw AppError.unprocessable("errors.rfiCloseNoteNeeded");
    }

    const caller = await callerUserId();
    try {
      const touched = await tx.db
        .update(schema.rfi)
        .set({
          status: "CLOSED",
          closedBy: caller,
          closedAt: now,
          closingNote: note,
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

  // ------------------------------------------- evidence (owner, 25/11/2026) --

  /**
   * The papers filed against an RFI: the sent e-mail, the reply. Newest
   * first. Read through the caller's transaction, so `document_read` decides
   * (ADR-0010); an RFI the caller may not see is a 404 before this runs.
   */
  async documents(contractId: string, rfiId: string): Promise<RfiDocument[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    await this.row(contractId, rfiId);
    const rows = await tx.db
      .select({
        id: schema.document.id,
        titleEl: schema.document.titleEl,
        filename: schema.document.filename,
        mime: schema.document.mime,
        size: schema.document.size,
        protocolNumber: schema.document.protocolNumber,
        uploadedByName: sql<string | null>`ecapital.user_display_name(${schema.document.uploadedBy})`,
        createdAt: schema.document.createdAt,
        deletedAt: schema.document.deletedAt,
      })
      .from(schema.document)
      .where(and(eq(schema.document.entityType, "rfi"), eq(schema.document.entityId, rfiId)))
      .orderBy(desc(schema.document.createdAt), desc(schema.document.version));
    // A tombstone (eArchive withdrew the protocol) has no bytes to show.
    return rows
      .filter((row) => !row.deletedAt)
      .map((row) => ({
        id: row.id,
        titleEl: row.titleEl,
        filename: row.filename,
        mime: row.mime,
        size: Number(row.size),
        protocolNumber: row.protocolNumber,
        uploadedByName: row.uploadedByName,
        createdAt: row.createdAt.toISOString(),
      }));
  }

  /**
   * Owner decision 25/11/2026: eCapital sends no e-mail; the engineer files
   * the sent message (or the reply) here. Any number of papers, open,
   * answered or closed — the correspondence is the record, and a reply that
   * arrives after the RFI was closed still belongs on it.
   */
  async addDocument(contractId: string, rfiId: string, upload: UploadInput): Promise<RfiDocument> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    await this.row(contractId, rfiId);
    const [rfi] = await tx.db
      .select({
        id: schema.rfi.id,
        contractId: schema.rfi.contractId,
        number: schema.rfi.number,
        questionEl: schema.rfi.questionEl,
        recipientName: schema.rfi.recipientName,
        orgUnitId: schema.rfi.orgUnitId,
      })
      .from(schema.rfi)
      .where(eq(schema.rfi.id, rfiId))
      .limit(1);
    if (!rfi) throw AppError.notFound("errors.rfiNotFound");

    try {
      const record = await this.files.fileRfiDocument(rfi, upload);
      const caller = await callerUserId();
      const [person] = await tx.db
        .select({ name: sql<string | null>`ecapital.user_display_name(${caller}::uuid)` })
        .from(sql`(select 1) as one`);
      return {
        id: record.id,
        titleEl: record.titleEl,
        filename: record.filename,
        mime: record.mime,
        size: record.size,
        protocolNumber: record.protocolNumber,
        uploadedByName: person?.name ?? null,
        createdAt: record.createdAt,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // The document row's policy said no (0030 `document_insert_rfi`): a
      // role that does not write the RFI log, or a unit it may not write.
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
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
  ): Promise<{ id: string; status: Rfi["status"]; raisedAt: Date }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(rfiId)) throw AppError.notFound("errors.rfiNotFound");
    const rows = await tx.db
      .select({ id: schema.rfi.id, status: schema.rfi.status, raisedAt: schema.rfi.raisedAt })
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
    // The CHECKs a caller can reach here are the answer and close rules and
    // 0030's recipient and sent-day rules, all of which the service checks
    // first; reaching one means the service rule was bypassed somehow.
    if (state === CHECK_VIOLATION) {
      const constraint = constraintName(error);
      if (constraint === "rfi_answered_on_not_before_raised") {
        throw AppError.unprocessable("errors.rfiAnsweredBeforeRaised");
      }
      if (constraint === "rfi_closed_answer_or_note") {
        throw AppError.unprocessable("errors.rfiCloseNoteNeeded");
      }
      if (constraint === "rfi_closing_note_length") throw AppError.badRequest("errors.rfiCloseNotValid");
      if (constraint === "rfi_sent_not_before_raised") {
        throw AppError.unprocessable("errors.rfiSentBeforeRaised");
      }
      if (constraint === "rfi_recipient_name_length") throw AppError.badRequest("errors.rfiRecipientNeeded");
      if (constraint === "rfi_recipient_email_shape") {
        throw AppError.badRequest("errors.rfiRecipientEmailNotValid");
      }
      throw AppError.unprocessable("errors.rfiNotValid");
    }
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
  recipientName: schema.rfi.recipientName,
  recipientEmail: schema.rfi.recipientEmail,
  sentOn: schema.rfi.sentOn,
  answeredOn: schema.rfi.answeredOn,
  closedById: schema.rfi.closedBy,
  closedByName: sql<string | null>`ecapital.user_display_name(${schema.rfi.closedBy})`,
  closedAt: schema.rfi.closedAt,
  closingNote: schema.rfi.closingNote,
};
