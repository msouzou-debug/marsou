import { Injectable } from "@nestjs/common";
import type { SiteInstruction, SiteInstructionCreate, Variation } from "@ecapital/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

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
        })
        .returning({ id: schema.siteInstruction.id });
      return await this.one(contractId, row.id);
    } catch (error) {
      this.writeError(error);
    }
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
    // The only CHECK a caller reaches here is the cost-impact one.
    if (state === CHECK_VIOLATION) throw AppError.unprocessable("errors.noCostImpact");
    throw error;
  }
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
  };
}

const VARIATION_COLUMNS = {
  id: schema.variation.id,
  contractId: schema.variation.contractId,
  number: schema.variation.number,
  descriptionEl: schema.variation.descriptionEl,
  reason: schema.variation.reason,
  value: schema.variation.value,
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
