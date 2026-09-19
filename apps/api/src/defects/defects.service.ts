import { Injectable } from "@nestjs/common";
import type {
  Defect,
  DefectBacklogRow,
  DefectCreate,
  DefectSource,
  DefectStatus,
  DefectUpdate,
  RiskBand,
} from "@ecapital/shared";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { UUID, callerUserId } from "../common/actor";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  constraintName,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import {
  BACKLOG_STATUSES,
  type DefectRow,
  backlogRows,
  handoverDueDate,
  toDefect,
} from "./defect-rows";

/** What `GET /defects` filters on. Every one of them is optional. */
export interface DefectQuery {
  unit: string[];
  contract: string | null;
  project: string | null;
  status: DefectStatus[];
  riskBand: RiskBand[];
  source: DefectSource[];
}

/** DefectCreate plus the unit, for a defect that hangs off nothing. */
export type DefectCreateInput = DefectCreate & { orgUnitId: string | null };

/**
 * M1 — the defect log (R12, R35). Έλλειψη, plural Ελλείψεις.
 *
 * A defect is the one record in the site log that does not need a contract.
 * It can be a snag found at handover, something the works turned up on a
 * project, or a technician's note from a plant room that belongs to no
 * project at all — CAPEX-01 §2 asks for Procore's field-first capture and §8
 * puts defect capture on the offline surfaces.
 *
 * RULE (ADR-0017): whatever else it has, a defect always belongs to a unit.
 * The unit is what decides who may see it and what the backlog is grouped by,
 * so it comes from the contract, or from the project, or from the body — and
 * a body with none of the three is refused with errors.defectUnitNeeded.
 *
 * No permission check in this file, by design (ADR-0010) — including the
 * technician's narrower write, which is a row policy in migration 0006 and
 * not an `if` here.
 */
@Injectable()
export class DefectsService {
  async list(query: DefectQuery): Promise<Defect[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const where: SQL[] = [];
    if (query.unit.length) where.push(inArray(schema.defect.orgUnitId, query.unit));
    if (query.contract !== null) {
      if (!UUID.test(query.contract)) throw AppError.badRequest("errors.defectQueryNotValid");
      where.push(eq(schema.defect.contractId, query.contract));
    }
    if (query.project !== null) {
      if (!UUID.test(query.project)) throw AppError.badRequest("errors.defectQueryNotValid");
      where.push(eq(schema.defect.projectId, query.project));
    }
    if (query.status.length) where.push(inArray(schema.defect.status, query.status));
    if (query.riskBand.length) where.push(inArray(schema.defect.riskBand, query.riskBand));
    if (query.source.length) where.push(inArray(schema.defect.source, query.source));

    // No unit clause beyond the caller's own filter: row-level security is
    // what decides which defects are in the answer (ADR-0010). A `unit=` a
    // caller may not read simply matches nothing.
    const rows = await tx.db
      .select(DEFECT_COLUMNS)
      .from(schema.defect)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(schema.defect.raisedAt));
    return rows.map((row) => toDefect(row as DefectRow));
  }

  async detail(id: string): Promise<Defect> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.defectNotFound");
    const rows = await tx.db
      .select(DEFECT_COLUMNS)
      .from(schema.defect)
      .where(eq(schema.defect.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.defectNotFound");
    return toDefect(rows[0] as DefectRow);
  }

  /**
   * RULE (R12): a HANDOVER defect takes its due date from the contract —
   * completion date, plus the extensions, plus the defects liability months
   * (see `handoverDueDate`). Every other source has no liability period, so
   * it has no due date and the field is null rather than invented.
   *
   * RULE (ADR-0017): the unit comes from the contract, then the project, then
   * the body. Where a contract is named and no project is, the project is
   * taken from the contract too, so a handover snag counts towards the
   * project's open defects without anybody typing the link twice.
   */
  async create(input: DefectCreateInput): Promise<Defect> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    let orgUnitId = input.orgUnitId;
    let projectId = input.projectId;
    let dueDate: string | null = null;

    if (input.contractId !== null) {
      const contract = await this.contractOf(input.contractId);
      orgUnitId = contract.orgUnitId;
      projectId = projectId ?? contract.projectId;
      if (input.source === "HANDOVER") {
        dueDate = handoverDueDate(
          contract.completionDate,
          contract.extensionDays,
          contract.defectsLiabilityMonths,
        );
      }
    } else if (projectId !== null) {
      orgUnitId = (await this.projectOf(projectId)).orgUnitId;
    }

    if (orgUnitId === null || orgUnitId === "") {
      throw AppError.badRequest("errors.defectUnitNeeded");
    }

    const caller = await callerUserId();
    try {
      const [row] = await tx.db
        .insert(schema.defect)
        .values({
          // The trigger in 0006 overwrites this from the contract or the
          // project where there is one, and leaves it alone where there is not.
          orgUnitId,
          source: input.source,
          contractId: input.contractId,
          projectId,
          areaId: input.areaId,
          descriptionEl: input.descriptionEl,
          estimatedCost:
            input.estimatedCost === null || input.estimatedCost === undefined
              ? null
              : String(input.estimatedCost),
          riskBand: input.riskBand,
          status: "OPEN",
          raisedBy: caller,
          dueDate,
        })
        .returning({ id: schema.defect.id });
      return await this.detail(row.id);
    } catch (error) {
      this.writeError(error);
    }
  }

  /**
   * RULE (R35): `funded` means a capital project is paying for this defect,
   * so a funded defect names that project — 422 errors.fundedNeedsProject
   * otherwise, and the CHECK in migration 0006 says the same to every other
   * code path. The rule is checked against the row as it will be, not as it
   * was: setting `funded` on a defect that already carries a target project
   * is fine, and clearing the target project on a funded one is not.
   *
   * RULE (R12): closing a defect records who closed it and when; reopening
   * one clears both, because a defect that is open again was not closed.
   */
  async update(id: string, input: DefectUpdate): Promise<Defect> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.detail(id);

    const funded = input.funded ?? existing.funded;
    const targetProjectId =
      input.targetProjectId === undefined ? existing.targetProjectId : input.targetProjectId;
    if (funded && targetProjectId === null) {
      throw AppError.unprocessable("errors.fundedNeedsProject");
    }
    if (targetProjectId !== null && targetProjectId !== existing.targetProjectId) {
      if (!UUID.test(targetProjectId)) throw AppError.notFound("errors.projectNotFound");
      await this.projectOf(targetProjectId);
    }

    const status = input.status ?? existing.status;
    const closing = status === "CLOSED" && existing.status !== "CLOSED";
    const reopening = status !== "CLOSED" && existing.status === "CLOSED";
    const caller = closing ? await callerUserId() : null;

    const values = pruned({
      descriptionEl: input.descriptionEl,
      estimatedCost:
        input.estimatedCost === undefined
          ? undefined
          : input.estimatedCost === null
            ? null
            : String(input.estimatedCost),
      riskBand: input.riskBand,
      funded: input.funded,
      targetProjectId: input.targetProjectId,
      status: input.status,
      closedAt: closing ? sql`now()` : reopening ? null : undefined,
      closedBy: closing ? caller : reopening ? null : undefined,
    });
    if (Object.keys(values).length === 0) return existing;

    try {
      const touched = await tx.db
        .update(schema.defect)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.defect.id, id))
        .returning({ id: schema.defect.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      this.writeError(error);
    }
    return this.detail(id);
  }

  /**
   * R35 — the costed, banded backlog, one row per unit per band over the
   * defects still to be dealt with. S21 draws it later; the shape is fixed in
   * packages/shared now so it can be.
   *
   * The grouping is done here rather than in SQL because `backlogRows` is the
   * rule and it is unit-tested on its own; the query is the filter.
   */
  async backlog(units: string[]): Promise<DefectBacklogRow[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const where: SQL[] = [inArray(schema.defect.status, BACKLOG_STATUSES)];
    if (units.length) where.push(inArray(schema.defect.orgUnitId, units));

    const rows = await tx.db
      .select({
        orgUnitId: schema.defect.orgUnitId,
        riskBand: schema.defect.riskBand,
        estimatedCost: schema.defect.estimatedCost,
        funded: schema.defect.funded,
      })
      .from(schema.defect)
      .where(and(...where));
    return backlogRows(rows);
  }

  // ------------------------------------------------------------- internals --

  private async contractOf(id: string): Promise<{
    id: string;
    orgUnitId: string;
    projectId: string;
    completionDate: string | null;
    extensionDays: number;
    defectsLiabilityMonths: number;
  }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.contractNotFound");
    const rows = await tx.db
      .select({
        id: schema.contract.id,
        orgUnitId: schema.contract.orgUnitId,
        projectId: schema.contract.projectId,
        completionDate: schema.contract.completionDate,
        extensionDays: schema.contract.extensionDays,
        defectsLiabilityMonths: schema.contract.defectsLiabilityMonths,
      })
      .from(schema.contract)
      .where(eq(schema.contract.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractNotFound");
    return rows[0];
  }

  private async projectOf(id: string): Promise<{ id: string; orgUnitId: string }> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.projectNotFound");
    const rows = await tx.db
      .select({ id: schema.project.id, orgUnitId: schema.project.orgUnitId })
      .from(schema.project)
      .where(eq(schema.project.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.projectNotFound");
    return rows[0];
  }

  /**
   * What the database refused, said in the caller's language. The 42501 is
   * the interesting one: it is what a technician gets for a HANDOVER defect
   * and what a read-only account gets for any of them, and both of them mean
   * the same thing to the person reading it — this is not yours to write.
   */
  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    if (state === CHECK_VIOLATION) {
      if (constraintName(error) === "defect_funded_needs_project") {
        throw AppError.unprocessable("errors.fundedNeedsProject");
      }
      throw AppError.unprocessable("errors.defectNotValid");
    }
    throw error;
  }
}

const DEFECT_COLUMNS = {
  id: schema.defect.id,
  orgUnitId: schema.defect.orgUnitId,
  source: schema.defect.source,
  contractId: schema.defect.contractId,
  projectId: schema.defect.projectId,
  areaId: schema.defect.areaId,
  assetId: schema.defect.assetId,
  descriptionEl: schema.defect.descriptionEl,
  photoIds: schema.defect.photoIds,
  estimatedCost: schema.defect.estimatedCost,
  riskBand: schema.defect.riskBand,
  funded: schema.defect.funded,
  targetProjectId: schema.defect.targetProjectId,
  status: schema.defect.status,
  raisedById: schema.defect.raisedBy,
  raisedByName: sql<string | null>`ecapital.user_display_name(${schema.defect.raisedBy})`,
  raisedAt: schema.defect.raisedAt,
  dueDate: schema.defect.dueDate,
  closedAt: schema.defect.closedAt,
  closedById: schema.defect.closedBy,
  closedByName: sql<string | null>`ecapital.user_display_name(${schema.defect.closedBy})`,
};

/** Drop the keys the caller did not send, so a PATCH touches only what it names. */
function pruned<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
