import { Injectable } from "@nestjs/common";
import {
  IcraMatrixVersion,
  IcraResult,
  type IcraInput,
  type IcraMatrixCell,
  type PatientRiskGroup,
} from "@ecapital/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, UNIQUE_VIOLATION, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { evaluate, type RiskCandidate } from "./icra-engine";

/**
 * M3 — the ICRA matrix and the engine that reads it (R20, CAPEX-01 §6.2).
 *
 * The matrix is reference data with a version and an effective date, and
 * ΟΚΥπΥ Infection Control «approves the local edition and can amend it
 * without a release». So there are exactly two writes in this file: a new
 * DRAFT version with all sixteen of its cells, and the activation that makes
 * one the ACTIVE edition and retires the one before.
 *
 * **A cell is never edited in place.** Not by this service, not by any route,
 * and the unique index on one ACTIVE version is what keeps «the matrix» a
 * question with one answer. A permit stores the version id it was decided
 * under (`permit.icra.matrixVersionId`), so a permit signed in March still
 * reads in November as the thing that was signed.
 *
 * There is no permission check in the read paths and there is not meant to be
 * one (ADR-0010): the matrix is readable by every signed-in role, because the
 * wizard shows it to whoever is filling it in.
 */
@Injectable()
export class IcraService {
  /** RULE (§6.2): the wizard asks «the matrix» and gets the ACTIVE edition. */
  async activeMatrix(): Promise<IcraMatrixVersion> {
    const rows = await this.versionRows({ status: "ACTIVE" });
    if (!rows.length) throw AppError.notFound("errors.icraMatrixNotFound");
    return rows[0];
  }

  /** Every edition, newest effective date first. Admin and clinical approvers. */
  async versions(): Promise<IcraMatrixVersion[]> {
    return this.versionRows({});
  }

  async version(id: string): Promise<IcraMatrixVersion> {
    const rows = await this.versionRows({ id });
    if (!rows.length) throw AppError.notFound("errors.icraMatrixNotFound");
    return rows[0];
  }

  /**
   * A new edition, DRAFT, with its sixteen cells written in the same
   * transaction as the version row. A version with fifteen cells is a version
   * that refuses to produce a class for somebody standing in a theatre, so
   * the count is checked before anything is written.
   */
  async createVersion(input: {
    id: string;
    basedOn: string;
    effectiveFrom: string;
    notesEl: string | null;
    approvedByName: string | null;
    cells: IcraMatrixCell[];
  }): Promise<IcraMatrixVersion> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const seen = new Set(input.cells.map((cell) => `${cell.activityType}:${cell.riskGroup}`));
    if (seen.size !== 16 || input.cells.length !== 16) {
      throw AppError.unprocessable("errors.icraMatrixIncomplete");
    }

    try {
      await tx.db.insert(schema.icraMatrixVersion).values({
        id: input.id,
        basedOn: input.basedOn,
        effectiveFrom: input.effectiveFrom,
        approvedByName: input.approvedByName,
        // A draft is not approved. Activation is what records the approval,
        // because that is the moment somebody took responsibility for it.
        approvedAt: null,
        status: "DRAFT",
        notesEl: input.notesEl,
      });
      for (const cell of input.cells) {
        await tx.db.insert(schema.icraMatrixCell).values({
          versionId: input.id,
          activityType: cell.activityType,
          riskGroup: cell.riskGroup,
          icraClass: cell.icraClass,
          controls: cell.controls,
        });
      }
    } catch (error) {
      throw this.writeError(error, input.id);
    }
    return this.version(input.id);
  }

  /**
   * RULE (§6.2): activating retires the edition before it. The unique index
   * on `status = 'ACTIVE'` means the two have to happen in one transaction
   * and in that order, which is also the honest description of what happens:
   * there is one local edition of the matrix and this is now it.
   *
   * A RETIRED edition never comes back. Reinstating one is publishing it
   * again under a new id, so the audit trail says who decided to.
   */
  async activate(id: string, now: Date): Promise<IcraMatrixVersion> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const target = await this.version(id);
    if (target.status === "ACTIVE") throw AppError.unprocessable("errors.icraMatrixAlreadyActive");
    if (target.status === "RETIRED") throw AppError.unprocessable("errors.icraMatrixRetired");

    try {
      await tx.db
        .update(schema.icraMatrixVersion)
        .set({ status: "RETIRED", updatedAt: sql`now()` })
        .where(eq(schema.icraMatrixVersion.status, "ACTIVE"));

      const touched = await tx.db
        .update(schema.icraMatrixVersion)
        .set({ status: "ACTIVE", approvedAt: now, updatedAt: sql`now()` })
        .where(eq(schema.icraMatrixVersion.id, id))
        .returning({ id: schema.icraMatrixVersion.id });
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      throw this.writeError(error, id);
    }
    return this.version(id);
  }

  /**
   * The engine, over the ACTIVE matrix and the real risk band of each area.
   *
   * The bands are read from `area`, never taken from the body: a caller that
   * could type its own risk group could type its way out of a Class IV.
   *
   * RULE (§6.2): `IcraInput.affectedAreaIds` is what the engineer picked.
   * Indirect impact is a property of a permit — it needs the systems list to
   * be worked out (§6.1) — so `POST /icra/evaluate` answers on the areas it
   * was given and `POST /permits/:id/icra` hands in the permit's resolved
   * list, direct and indirect together.
   */
  async evaluate(input: IcraInput): Promise<IcraResult> {
    const matrix = await this.activeMatrix();
    const areas = await this.riskCandidates(input.affectedAreaIds);
    const surrounding = await this.withResolvedSurrounding(input.surrounding);
    return IcraResult.parse(
      evaluate({
        activityType: input.activityType,
        workKind: input.workKind,
        areas,
        surrounding,
        matrix,
      }),
    );
  }

  /** The ICRA Table 2 band of each area, in the order asked for. */
  async riskCandidates(areaIds: string[]): Promise<RiskCandidate[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const ids = areaIds.filter((id) => UUID.test(id));
    if (!ids.length) throw AppError.badRequest("errors.permitAreaNotFound");

    const rows = await tx.db
      .select({ id: schema.area.id, patientRiskGroup: schema.area.patientRiskGroup })
      .from(schema.area)
      .where(inArray(schema.area.id, ids));
    const byId = new Map(rows.map((row) => [row.id, row.patientRiskGroup]));

    return areaIds.map((id) => {
      const group = byId.get(id);
      // An area the caller cannot read does not exist for them (ADR-0010), and
      // an ICRA over an area nobody can name is not an ICRA.
      if (!group) throw AppError.notFound("errors.permitAreaNotFound");
      return { id, patientRiskGroup: group };
    });
  }

  /**
   * A surrounding side that names an area carries that area's band, read from
   * the register. One that names none keeps whatever band the assessor typed.
   */
  async withResolvedSurrounding(
    surrounding: IcraInput["surrounding"],
  ): Promise<IcraInput["surrounding"]> {
    const withAreas = surrounding.filter((side) => side.areaId && UUID.test(side.areaId));
    if (!withAreas.length) return surrounding;
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const rows = await tx.db
      .select({ id: schema.area.id, patientRiskGroup: schema.area.patientRiskGroup })
      .from(schema.area)
      .where(inArray(schema.area.id, withAreas.map((side) => side.areaId as string)));
    const byId = new Map<string, PatientRiskGroup>(
      rows.map((row) => [row.id, row.patientRiskGroup]),
    );

    return surrounding.map((side) => {
      if (!side.areaId) return side;
      const group = byId.get(side.areaId);
      if (!group) throw AppError.notFound("errors.permitAreaNotFound");
      return { ...side, patientRiskGroup: group };
    });
  }

  // ------------------------------------------------------------ internals --

  private async versionRows(filter: {
    id?: string;
    status?: "DRAFT" | "ACTIVE" | "RETIRED";
  }): Promise<IcraMatrixVersion[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const clauses = [];
    if (filter.id) clauses.push(eq(schema.icraMatrixVersion.id, filter.id));
    if (filter.status) clauses.push(eq(schema.icraMatrixVersion.status, filter.status));

    const versions = await tx.db
      .select()
      .from(schema.icraMatrixVersion)
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(asc(schema.icraMatrixVersion.effectiveFrom), asc(schema.icraMatrixVersion.id));
    if (!versions.length) return [];

    const cells = await tx.db
      .select()
      .from(schema.icraMatrixCell)
      .where(
        inArray(
          schema.icraMatrixCell.versionId,
          versions.map((v) => v.id),
        ),
      )
      .orderBy(asc(schema.icraMatrixCell.activityType), asc(schema.icraMatrixCell.riskGroup));

    return versions
      .map((version) =>
        IcraMatrixVersion.parse({
          id: version.id,
          basedOn: version.basedOn,
          effectiveFrom: version.effectiveFrom,
          approvedByName: version.approvedByName,
          approvedAt: version.approvedAt ? version.approvedAt.toISOString() : null,
          status: version.status,
          notesEl: version.notesEl,
          cells: cells
            .filter((cell) => cell.versionId === version.id)
            .map((cell) => ({
              activityType: cell.activityType,
              riskGroup: cell.riskGroup,
              icraClass: cell.icraClass,
              controls: cell.controls,
            })),
        }),
      )
      .reverse();
  }

  private writeError(error: unknown, id: string): never {
    if (error instanceof AppError) throw error;
    const state = sqlState(error);
    if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
    if (state === UNIQUE_VIOLATION) throw AppError.conflict("errors.icraMatrixIdTaken", { id });
    throw error;
  }
}
