import { Injectable } from "@nestjs/common";
import type {
  SiteInstruction,
  SiteInstructionCreate,
  SiteInstructionDocument,
  SiteInstructionUpdate,
  Variation,
} from "@ecapital/shared";
import { DEFAULT_VAT_RATE, nicosiaDateOf } from "@ecapital/shared";
import { type SQL, and, desc, eq, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  constraintName,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DocumentsService, type UploadInput } from "../documents/documents.service";

/**
 * RULE (owner, 26/11/2026, the RFI's rule): the day an instruction was sent
 * is not before the day it was issued. «Not after today» is the zod schema's.
 * The CHECK `site_instruction_sent_not_before_issued` (0034) says the same to
 * every code path.
 */
export function sentBeforeIssued(issuedOn: string, sentOn: string | null | undefined): boolean {
  return typeof sentOn === "string" && sentOn < issuedOn;
}

/**
 * M1 — the site instruction log (R09). Οδηγία εργοταξίου: a written direction
 * to the contractor, numbered per contract, issued by whoever is signed in.
 *
 * RULE (CAPEX-01 §4, R09): an instruction that carries cost impact has to end
 * up as a variation, because the work is being done whether or not anybody
 * priced it. This service is where that link is made, and the contract's
 * warnings count the ones where it has not been (R31, warn and flag — it
 * never blocks).
 *
 * No permission check in this file, by design (ADR-0010).
 */
@Injectable()
export class SiteInstructionsService {
  constructor(private readonly files: DocumentsService) {}

  /** Newest first, like the variation list, and for the same reason. */
  async list(contractId: string): Promise<SiteInstruction[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);

    const rows = await tx.db
      .select(INSTRUCTION_COLUMNS)
      .from(schema.siteInstruction)
      .where(eq(schema.siteInstruction.contractId, contractId))
      .orderBy(desc(schema.siteInstruction.number));
    return rows.map(toSiteInstruction);
  }

  /**
   * The number comes from ecapital.allocate_site_instruction_number, behind
   * the same transaction-scoped advisory lock the variation number uses
   * (ADR-0015): two people issuing an instruction in the same second queue
   * rather than race.
   */
  async create(contractId: string, input: SiteInstructionCreate): Promise<SiteInstruction> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const caller = await callerUserId();
    // Owner request 26/11/2026: sent not before the day it was issued.
    if (sentBeforeIssued(input.issuedOn ?? nicosiaDateOf(new Date()), input.sentOn)) {
      throw AppError.unprocessable("errors.siteInstructionSentBeforeIssued");
    }

    try {
      const [{ number }] = await tx.db
        .select({
          number: sql<number>`ecapital.allocate_site_instruction_number(${contractId}::uuid)`,
        })
        .from(sql`(select 1) as one`);

      const [row] = await tx.db
        .insert(schema.siteInstruction)
        .values({
          contractId,
          // The trigger overwrites this from the contract; it is here because
          // the column is NOT NULL.
          orgUnitId: "",
          number,
          textEl: input.textEl,
          costImpactFlag: input.costImpactFlag,
          issuedBy: caller,
          recipientName: input.recipientName?.trim() || null,
          recipientEmail: input.recipientEmail?.trim() || null,
          sentOn: input.sentOn ?? null,
          // Left to the column default (now) unless the instruction was given
          // on an earlier day than the one it is typed in on.
          ...(input.issuedOn !== undefined && input.issuedOn !== nicosiaDateOf(new Date())
            ? { issuedAt: onDay(input.issuedOn) }
            : {}),
        })
        .returning({ id: schema.siteInstruction.id });
      return await this.one(contractId, row.id);
    } catch (error) {
      this.writeError(error);
    }
  }

  /**
   * UAT 25/11/2026: correcting an instruction — its text, its cost impact and
   * the day it was issued — for as long as it has not been turned into a
   * variation. Who issued it is the record and is not changed here. The audit
   * trigger on ecapital.site_instruction (migration 0006) keeps the old and
   * new values of every change.
   *
   * RULE (R09, UAT 25/11/2026): an instruction that already has a variation
   * is settled — 422 errors.siteInstructionSettled. The variation carries
   * what it costs from then on, and an instruction edited after the fact
   * would no longer say what the variation was raised from.
   *
   * RULE (owner, UAT 25/11/2026): the issue day is not after today; the
   * schema refuses that before this runs (400 errors.dateInFuture).
   */
  async update(
    contractId: string,
    instructionId: string,
    input: Partial<SiteInstructionUpdate>,
  ): Promise<SiteInstruction> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const existing = await this.one(contractId, instructionId);
    if (existing.variationId !== null) {
      throw AppError.unprocessable("errors.siteInstructionSettled");
    }

    const values: {
      textEl?: string;
      costImpactFlag?: boolean;
      issuedAt?: SQL;
      recipientName?: string | null;
      recipientEmail?: string | null;
      sentOn?: string | null;
    } = {};
    if (input.textEl !== undefined && input.textEl !== existing.textEl) values.textEl = input.textEl;
    if (input.costImpactFlag !== undefined && input.costImpactFlag !== existing.costImpactFlag) {
      values.costImpactFlag = input.costImpactFlag;
    }
    if (input.issuedOn !== undefined && input.issuedOn !== nicosiaDateOf(existing.issuedAt)) {
      values.issuedAt = onDay(input.issuedOn);
    }
    // Owner request 26/11/2026: who it went to and when it left. A value sent
    // unchanged is left alone, so saving the form writes no audit line for a
    // field nobody touched.
    if (input.recipientName !== undefined) {
      const name = input.recipientName?.trim() || null;
      if (name !== (existing.recipientName ?? null)) values.recipientName = name;
    }
    if (input.recipientEmail !== undefined) {
      const email = input.recipientEmail?.trim() || null;
      if (email !== (existing.recipientEmail ?? null)) values.recipientEmail = email;
    }
    if (input.sentOn !== undefined && input.sentOn !== (existing.sentOn ?? null)) {
      values.sentOn = input.sentOn;
    }
    // RULE (owner, 26/11/2026): the sent day and the issue day as they will
    // stand after this change — moving either can break the rule.
    const issuedOn = input.issuedOn ?? nicosiaDateOf(existing.issuedAt);
    const sentOn = input.sentOn !== undefined ? input.sentOn : (existing.sentOn ?? null);
    if (
      (values.sentOn !== undefined || values.issuedAt !== undefined) &&
      sentBeforeIssued(issuedOn, sentOn)
    ) {
      throw AppError.unprocessable("errors.siteInstructionSentBeforeIssued");
    }
    if (Object.keys(values).length === 0) return existing;

    try {
      const touched = await tx.db
        .update(schema.siteInstruction)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.siteInstruction.id, instructionId))
        .returning({ id: schema.siteInstruction.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }
    return this.one(contractId, instructionId);
  }

  /**
   * RULE (R09, R10): turning an instruction into a variation is allowed once,
   * and only for an instruction that carries cost impact.
   *
   *   - no cost impact → 422 errors.noCostImpact. An instruction that costs
   *     nothing has nothing to turn into; if it turns out it did cost
   *     something, the flag is what gets corrected, and the correction is in
   *     the audit trail.
   *   - already linked → 422 errors.alreadyLinked. A second variation from
   *     the same instruction would charge the same change twice.
   *
   * Both are also CHECK and UNIQUE constraints in migration 0006, for the
   * reason ADR-0015 gives: the spreadsheet importer and the repair script are
   * code paths nobody has written yet.
   *
   * The variation starts where every variation starts — DRAFT, raised by the
   * caller, numbered by the database (R10) — and carries the instruction's own
   * words as its description, reason CLIENT_CHANGE because an instruction is
   * the client telling the contractor to do something, and a value of zero
   * for the engineer to price. Nothing is committed until somebody approves
   * it (CAPEX-01 §7).
   */
  async createVariation(contractId: string, instructionId: string): Promise<Variation> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const instruction = await this.one(contractId, instructionId);

    if (!instruction.costImpactFlag) throw AppError.unprocessable("errors.noCostImpact");
    if (instruction.variationId !== null) throw AppError.unprocessable("errors.alreadyLinked");

    const caller = await callerUserId();
    let variationId: string;
    try {
      const [{ number }] = await tx.db
        .select({ number: sql<number>`ecapital.allocate_variation_number(${contractId}::uuid)` })
        .from(sql`(select 1) as one`);

      const [created] = await tx.db
        .insert(schema.variation)
        .values({
          contractId,
          orgUnitId: "",
          number,
          descriptionEl: instruction.textEl,
          reason: "CLIENT_CHANGE",
          // Priced by the engineer before it is submitted. Zero is honest:
          // nobody has said what it costs yet.
          value: "0",
          timeImpactDays: 0,
          status: "DRAFT",
          raisedBy: caller,
        })
        .returning({ id: schema.variation.id });
      variationId = created.id;

      const linked = await tx.db
        .update(schema.siteInstruction)
        .set({ variationId, updatedAt: sql`now()` })
        .where(eq(schema.siteInstruction.id, instructionId))
        .returning({ id: schema.siteInstruction.id });
      if (!linked.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }

    const rows = await tx.db
      .select(VARIATION_COLUMNS)
      .from(schema.variation)
      .where(eq(schema.variation.id, variationId))
      .limit(1);
    if (!rows.length) throw AppError.internal();
    return toVariation(rows[0]);
  }

  // ------------------------------- correspondence (owner, 26/11/2026) --

  /**
   * The papers filed against an instruction: the sent e-mail, the letter, a
   * reply. Newest first. Read through the caller's transaction, so
   * `document_read` decides (ADR-0010); an instruction the caller may not see
   * is a 404 before this runs.
   */
  async documents(contractId: string, instructionId: string): Promise<SiteInstructionDocument[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    await this.one(contractId, instructionId);
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
      .where(
        and(
          eq(schema.document.entityType, "site_instruction"),
          eq(schema.document.entityId, instructionId),
        ),
      )
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
   * Owner request 26/11/2026: eCapital sends no e-mail; the engineer files the
   * sent message or the letter here. Any number of papers, whether or not the
   * instruction has become a variation — the correspondence is the record.
   */
  async addDocument(
    contractId: string,
    instructionId: string,
    upload: UploadInput,
  ): Promise<SiteInstructionDocument> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.contractOf(contractId);
    const instruction = await this.one(contractId, instructionId);

    try {
      const record = await this.files.fileSiteInstructionDocument(
        {
          id: instruction.id,
          contractId: instruction.contractId,
          number: instruction.number,
          textEl: instruction.textEl,
          recipientName: instruction.recipientName ?? null,
          orgUnitId: instruction.orgUnitId,
        },
        upload,
      );
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
      // The document row's policy said no (0034
      // `document_insert_site_instruction`): a role that does not write the
      // site instruction log, or a unit it may not write.
      if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
        throw AppError.forbidden("errors.readOnlyAccount");
      }
      throw error;
    }
  }

  // ------------------------------------------------------------- internals --

  private async one(contractId: string, instructionId: string): Promise<SiteInstruction> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(instructionId)) throw AppError.notFound("errors.siteInstructionNotFound");
    const rows = await tx.db
      .select(INSTRUCTION_COLUMNS)
      .from(schema.siteInstruction)
      .where(
        and(
          eq(schema.siteInstruction.id, instructionId),
          eq(schema.siteInstruction.contractId, contractId),
        ),
      )
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.siteInstructionNotFound");
    return toSiteInstruction(rows[0]);
  }

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
    // The unique index on variation_id is the second statement of "once".
    if (state === UNIQUE_VIOLATION) throw AppError.unprocessable("errors.alreadyLinked");
    if (state === CHECK_VIOLATION) {
      // 0034's recipient and sent-day rules, which the service checks first;
      // reaching one means the service rule was bypassed somehow.
      const constraint = constraintName(error);
      if (constraint === "site_instruction_sent_not_before_issued") {
        throw AppError.unprocessable("errors.siteInstructionSentBeforeIssued");
      }
      if (constraint === "site_instruction_recipient_name_length") {
        throw AppError.badRequest("errors.siteInstructionRecipientNotValid");
      }
      if (constraint === "site_instruction_recipient_email_shape") {
        throw AppError.badRequest("errors.siteInstructionRecipientEmailNotValid");
      }
      // Otherwise the cost-impact one.
      throw AppError.unprocessable("errors.noCostImpact");
    }
    throw error;
  }
}

/**
 * A day typed into a form, as the instant stored for it: midday in Nicosia,
 * so the date reads the same on every screen whatever the season — or now,
 * if today's midday has not come yet, so a record never happened in the
 * future.
 */
function onDay(isoDate: string): SQL {
  return sql`least(((${isoDate})::date + time '12:00') at time zone 'Europe/Nicosia', now())`;
}

const INSTRUCTION_COLUMNS = {
  id: schema.siteInstruction.id,
  contractId: schema.siteInstruction.contractId,
  orgUnitId: schema.siteInstruction.orgUnitId,
  number: schema.siteInstruction.number,
  textEl: schema.siteInstruction.textEl,
  issuedById: schema.siteInstruction.issuedBy,
  issuedByName: sql<
    string | null
  >`ecapital.user_display_name(${schema.siteInstruction.issuedBy})`,
  issuedAt: schema.siteInstruction.issuedAt,
  costImpactFlag: schema.siteInstruction.costImpactFlag,
  variationId: schema.siteInstruction.variationId,
  recipientName: schema.siteInstruction.recipientName,
  recipientEmail: schema.siteInstruction.recipientEmail,
  sentOn: schema.siteInstruction.sentOn,
};

interface InstructionSelect {
  id: string;
  contractId: string;
  orgUnitId: string;
  number: number;
  textEl: string;
  issuedById: string;
  issuedByName: string | null;
  issuedAt: Date;
  costImpactFlag: boolean;
  variationId: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  /** A `date` column: drizzle hands it back as yyyy-mm-dd. */
  sentOn: string | null;
}

function toSiteInstruction(row: InstructionSelect): SiteInstruction {
  return {
    id: row.id,
    contractId: row.contractId,
    orgUnitId: row.orgUnitId,
    number: row.number,
    textEl: row.textEl,
    issuedById: row.issuedById,
    issuedByName: row.issuedByName ?? "",
    issuedAt: row.issuedAt.toISOString(),
    costImpactFlag: row.costImpactFlag,
    variationId: row.variationId,
    recipientName: row.recipientName,
    recipientEmail: row.recipientEmail,
    sentOn: row.sentOn,
  };
}

const VARIATION_COLUMNS = {
  id: schema.variation.id,
  contractId: schema.variation.contractId,
  number: schema.variation.number,
  descriptionEl: schema.variation.descriptionEl,
  reason: schema.variation.reason,
  value: schema.variation.value,
  vatRate: schema.variation.vatRate,
  vatAmount: schema.variation.vatAmount,
  grossValue: schema.variation.grossValue,
  timeImpactDays: schema.variation.timeImpactDays,
  status: schema.variation.status,
  raisedById: schema.variation.raisedBy,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.variation.raisedBy})`,
  raisedAt: schema.variation.raisedAt,
  decidedById: schema.variation.decidedBy,
  decidedByName: sql<string | null>`ecapital.user_display_name(${schema.variation.decidedBy})`,
  decidedAt: schema.variation.decidedAt,
  decisionCommentEl: schema.variation.decisionCommentEl,
};

interface VariationSelect {
  id: string;
  contractId: string;
  number: number;
  descriptionEl: string;
  reason: Variation["reason"];
  value: string | number;
  vatRate: Variation["vatRate"] | null;
  vatAmount: string | number | null;
  grossValue: string | number | null;
  timeImpactDays: number;
  status: Variation["status"];
  raisedById: string;
  raisedByName: string | null;
  raisedAt: Date;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionCommentEl: string | null;
}

function toVariation(row: VariationSelect): Variation {
  return {
    id: row.id,
    contractId: row.contractId,
    number: row.number,
    descriptionEl: row.descriptionEl,
    reason: row.reason,
    value: typeof row.value === "number" ? row.value : Number(row.value),
    // ADR-0038: the contract's rate, taken by the database when the variation was made.
    vatRate: row.vatRate ?? DEFAULT_VAT_RATE,
    vat: Number(row.vatAmount ?? 0),
    gross: Number(row.grossValue ?? 0),
    timeImpactDays: row.timeImpactDays,
    status: row.status,
    raisedById: row.raisedById,
    raisedByName: row.raisedByName ?? "",
    raisedAt: row.raisedAt.toISOString(),
    decidedById: row.decidedById,
    decidedByName: row.decidedByName ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionCommentEl: row.decisionCommentEl,
  };
}
