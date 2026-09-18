import { Injectable } from "@nestjs/common";
import { Area, AreaCreate, AreaTree, Building, Floor } from "@ecapital/shared";
import { asc, eq } from "drizzle-orm";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

/** Postgres says 42501 when a row violates a policy or a grant. */
const INSUFFICIENT_PRIVILEGE = "42501";
const UNIQUE_VIOLATION = "23505";

/** Drizzle wraps the driver's error, so the SQLSTATE is one level down. */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

@Injectable()
export class AreasService {
  /**
   * The building → floor → area tree for one unit.
   *
   * There is no permission check in this method and there is not meant to be
   * one. Under row-level security a unit the caller may not see does not
   * exist for them: the select returns nothing, exactly as it would for a
   * misspelt id. So the answer is 404 and not 403 — 403 would confirm that
   * the unit exists, which is the one fact a caller outside it should not be
   * able to learn (CAPEX-01 §10).
   */
  async treeFor(orgUnitId: string): Promise<AreaTree> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const units = await tx.db
      .select({ id: schema.orgUnit.id })
      .from(schema.orgUnit)
      .where(eq(schema.orgUnit.id, orgUnitId))
      .limit(1);
    if (!units.length) throw AppError.notFound("errors.unitNotFound");

    const buildings = await tx.db
      .select()
      .from(schema.building)
      .where(eq(schema.building.orgUnitId, orgUnitId))
      .orderBy(asc(schema.building.code));

    const floors = await tx.db
      .select()
      .from(schema.floor)
      .where(eq(schema.floor.orgUnitId, orgUnitId))
      .orderBy(asc(schema.floor.code));

    const areas = await tx.db
      .select()
      .from(schema.area)
      .where(eq(schema.area.orgUnitId, orgUnitId))
      .orderBy(asc(schema.area.code));

    const areasByFloor = new Map<string, Area[]>();
    for (const row of areas) {
      const list = areasByFloor.get(row.floorId) ?? [];
      list.push(
        Area.parse({
          id: row.id,
          floorId: row.floorId,
          code: row.code,
          nameEl: row.nameEl,
          areaType: row.areaType,
          patientRiskGroup: row.patientRiskGroup,
          costCentre: row.costCentre,
          beds: row.beds,
        }),
      );
      areasByFloor.set(row.floorId, list);
    }

    const floorsByBuilding = new Map<string, Floor[]>();
    for (const row of floors) {
      const list = floorsByBuilding.get(row.buildingId) ?? [];
      list.push(
        Floor.parse({
          id: row.id,
          buildingId: row.buildingId,
          code: row.code,
          nameEl: row.nameEl,
          level: row.level,
          areas: areasByFloor.get(row.id) ?? [],
        }),
      );
      floorsByBuilding.set(row.buildingId, list);
    }

    return AreaTree.parse({
      orgUnitId,
      buildings: buildings.map((row) =>
        Building.parse({
          id: row.id,
          orgUnitId: row.orgUnitId,
          code: row.code,
          nameEl: row.nameEl,
          // numeric comes back as a string so no precision is lost on the way.
          grossAreaM2: row.grossAreaM2 === null ? null : Number(row.grossAreaM2),
          yearBuilt: row.yearBuilt,
          storeys: row.storeys,
          floors: floorsByBuilding.get(row.id) ?? [],
        }),
      ),
    });
  }

  /**
   * Add an area to a floor of this unit. The write policy decides whether the
   * caller may: an auditor, or anyone outside the unit, is refused by the
   * database, and the audit trigger writes the row that records who did it
   * (R42). The insert and its audit row share one transaction, so neither can
   * exist without the other.
   */
  async create(orgUnitId: string, input: AreaCreate): Promise<Area> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const floors = await tx.db
      .select({ id: schema.floor.id, orgUnitId: schema.floor.orgUnitId })
      .from(schema.floor)
      .where(eq(schema.floor.id, input.floorId))
      .limit(1);
    const floor = floors[0];
    // Same reasoning as above: a floor in a unit the caller cannot see is
    // invisible, not forbidden.
    if (!floor || floor.orgUnitId !== orgUnitId) throw AppError.notFound("errors.floorNotFound");

    try {
      const [row] = await tx.db
        .insert(schema.area)
        .values({
          floorId: input.floorId,
          orgUnitId,
          code: input.code,
          nameEl: input.nameEl,
          areaType: input.areaType,
          patientRiskGroup: input.patientRiskGroup,
          costCentre: input.costCentre ?? null,
          beds: input.beds ?? null,
        })
        .returning();

      return Area.parse({
        id: row.id,
        floorId: row.floorId,
        code: row.code,
        nameEl: row.nameEl,
        areaType: row.areaType,
        patientRiskGroup: row.patientRiskGroup,
        costCentre: row.costCentre,
        beds: row.beds,
      });
    } catch (error) {
      const code = sqlState(error);
      if (code === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (code === UNIQUE_VIOLATION) {
        throw AppError.badRequest("errors.areaCodeTaken", { code: input.code });
      }
      throw error;
    }
  }
}
