import { Injectable } from "@nestjs/common";
import { AffectedArea, type PermitSystem, type SystemFeed } from "@ecapital/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { INSUFFICIENT_PRIVILEGE, sqlState } from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

export interface SystemFeedWrite {
  orgUnitId: string;
  system: PermitSystem;
  sourceAreaId: string | null;
  servesAreaIds: string[];
  labelEl: string;
}

/**
 * M3 — system feeds and indirect impact (R19, CAPEX-01 §6.1).
 *
 * «Pulling a riser feeds theatres two floors up — model that with
 * `serves_area_ids` on the asset, and warn on indirect impact.»
 *
 * The asset register is M4 and the permit module is M3, so a `system_feed`
 * row carries the same fact until `asset.serves_area_ids` exists: this
 * system, from this source area (or from nowhere in particular, meaning the
 * whole unit), serves these areas. ADR-0026 records it as a **seam**, not a
 * second model — when M4 lands, the query behind `GET /areas/impact` changes
 * and nothing above it does.
 *
 * RULE (§6.1): an indirect area «counts for routing and for the ICRA risk
 * group exactly like a direct one; the UI only labels them». Nothing in this
 * file treats an indirect area as lesser, and DIRECT wins a tie only because
 * an area the engineer picked should be described as picked.
 */
@Injectable()
export class SystemFeedsService {
  async list(orgUnitId: string | null): Promise<SystemFeed[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select()
      .from(schema.systemFeed)
      .where(orgUnitId ? eq(schema.systemFeed.orgUnitId, orgUnitId) : undefined)
      .orderBy(asc(schema.systemFeed.orgUnitId), asc(schema.systemFeed.system), asc(schema.systemFeed.labelEl));
    return rows.map(toSystemFeed);
  }

  async create(input: SystemFeedWrite): Promise<SystemFeed> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.checkAreas(input.orgUnitId, input.sourceAreaId, input.servesAreaIds);
    try {
      const [row] = await tx.db
        .insert(schema.systemFeed)
        .values({
          orgUnitId: input.orgUnitId,
          system: input.system,
          sourceAreaId: input.sourceAreaId,
          servesAreaIds: input.servesAreaIds,
          labelEl: input.labelEl,
        })
        .returning();
      return toSystemFeed(row);
    } catch (error) {
      throw this.writeError(error);
    }
  }

  async update(id: string, input: Partial<SystemFeedWrite>): Promise<SystemFeed> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.one(id);
    await this.checkAreas(
      existing.orgUnitId,
      input.sourceAreaId === undefined ? existing.sourceAreaId : input.sourceAreaId,
      input.servesAreaIds ?? existing.servesAreaIds,
    );

    try {
      const touched = await tx.db
        .update(schema.systemFeed)
        .set({
          system: input.system ?? existing.system,
          sourceAreaId:
            input.sourceAreaId === undefined ? existing.sourceAreaId : input.sourceAreaId,
          servesAreaIds: input.servesAreaIds ?? existing.servesAreaIds,
          labelEl: input.labelEl ?? existing.labelEl,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.systemFeed.id, id))
        .returning();
      // Nothing came back: the policy refused the write, which is a 403 and
      // not a 404 — the caller can see the row, they may not change it.
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return toSystemFeed(touched[0]);
    } catch (error) {
      throw this.writeError(error);
    }
  }

  async remove(id: string): Promise<void> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    await this.one(id);
    try {
      const gone = await tx.db
        .delete(schema.systemFeed)
        .where(eq(schema.systemFeed.id, id))
        .returning({ id: schema.systemFeed.id });
      if (!gone.length) throw AppError.forbidden("errors.readOnlyAccount");
    } catch (error) {
      throw this.writeError(error);
    }
  }

  async one(id: string): Promise<SystemFeed> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.systemFeedNotFound");
    const rows = await tx.db
      .select()
      .from(schema.systemFeed)
      .where(eq(schema.systemFeed.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.systemFeedNotFound");
    return toSystemFeed(rows[0]);
  }

  /**
   * R19: what this shutdown actually touches.
   *
   * DIRECT is what the engineer picked. INDIRECT is every area a feed of one
   * of the chosen systems serves, where the feed either starts in one of the
   * picked areas or serves the whole unit — the main LV board, which is
   * downstream of nothing and upstream of everything.
   *
   * The answer is deduped with DIRECT winning: an ICU that is both picked and
   * downstream of the riser is one row, and it is the one that says the
   * engineer knew about it.
   */
  async impact(
    orgUnitId: string,
    systems: PermitSystem[],
    areaIds: string[],
  ): Promise<AffectedArea[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const picked = areaIds.filter((id) => UUID.test(id));
    if (!picked.length) throw AppError.badRequest("errors.permitAreaNotFound");

    const feeds = systems.length
      ? await tx.db
          .select()
          .from(schema.systemFeed)
          .where(
            and(
              eq(schema.systemFeed.orgUnitId, orgUnitId),
              inArray(schema.systemFeed.system, systems),
            ),
          )
      : [];

    // `viaSystem` records which system carried the impact, so S11 can say
    // «έμμεσα, μέσω ιατρικών αερίων» rather than just «έμμεσα».
    const indirect = new Map<string, PermitSystem>();
    for (const feed of feeds) {
      const fires = feed.sourceAreaId === null || picked.includes(feed.sourceAreaId);
      if (!fires) continue;
      for (const served of feed.servesAreaIds) {
        if (!indirect.has(served)) indirect.set(served, feed.system);
      }
    }
    for (const id of picked) indirect.delete(id);

    const rows = await this.areaFacts(orgUnitId, [...picked, ...indirect.keys()]);
    const ordered: AffectedArea[] = [];
    for (const id of picked) {
      const fact = rows.get(id);
      if (!fact) throw AppError.notFound("errors.permitAreaNotFound");
      ordered.push(AffectedArea.parse({ ...fact, impact: "DIRECT", viaSystem: null }));
    }
    for (const [id, viaSystem] of indirect) {
      const fact = rows.get(id);
      // A feed that points at an area of another unit, or one that has been
      // deleted, is stale data and not a reason to fail the request.
      if (!fact) continue;
      ordered.push(AffectedArea.parse({ ...fact, impact: "INDIRECT", viaSystem }));
    }
    return ordered;
  }

  /** The area, its building and its floor, which is what `AffectedArea` shows. */
  async areaFacts(
    orgUnitId: string | null,
    areaIds: string[],
  ): Promise<Map<string, Omit<AffectedArea, "impact" | "viaSystem">>> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const ids = areaIds.filter((id) => UUID.test(id));
    if (!ids.length) return new Map();

    const clauses = [inArray(schema.area.id, ids)];
    if (orgUnitId) clauses.push(eq(schema.area.orgUnitId, orgUnitId));

    const rows = await tx.db
      .select({
        areaId: schema.area.id,
        code: schema.area.code,
        nameEl: schema.area.nameEl,
        areaType: schema.area.areaType,
        patientRiskGroup: schema.area.patientRiskGroup,
        floorCode: schema.floor.code,
        buildingCode: schema.building.code,
      })
      .from(schema.area)
      .innerJoin(schema.floor, eq(schema.floor.id, schema.area.floorId))
      .innerJoin(schema.building, eq(schema.building.id, schema.floor.buildingId))
      .where(and(...clauses));

    return new Map(rows.map((row) => [row.areaId, row]));
  }

  // ------------------------------------------------------------ internals --

  /** Every area a feed names has to be in the feed's own unit. */
  private async checkAreas(
    orgUnitId: string,
    sourceAreaId: string | null,
    servesAreaIds: string[],
  ): Promise<void> {
    const named = [...servesAreaIds, ...(sourceAreaId ? [sourceAreaId] : [])];
    if (!named.length) return;
    const facts = await this.areaFacts(orgUnitId, named);
    for (const id of named) {
      if (!facts.has(id)) throw AppError.notFound("errors.permitAreaNotFound");
    }
  }

  private writeError(error: unknown): never {
    if (error instanceof AppError) throw error;
    if (sqlState(error) === INSUFFICIENT_PRIVILEGE) {
      throw AppError.forbidden("errors.readOnlyAccount");
    }
    throw error;
  }
}

function toSystemFeed(row: typeof schema.systemFeed.$inferSelect): SystemFeed {
  return {
    id: row.id,
    orgUnitId: row.orgUnitId,
    system: row.system,
    sourceAreaId: row.sourceAreaId,
    servesAreaIds: row.servesAreaIds,
    labelEl: row.labelEl,
  };
}
