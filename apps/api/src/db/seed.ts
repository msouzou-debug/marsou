/**
 * Seed the eleven org units and their aliases, one building at Nicosia
 * General with two floors and six areas, seven development users, the
 * group→role mappings, the 42-project M1 register (see ./seed-projects) and
 * the contract register on top of it (see ./seed-contracts).
 *
 *   pnpm --filter @ecapital/api seed
 *
 * It connects as the migration role, which owns the tables and is therefore
 * not filtered by row-level security — a seed that could only see its own
 * units would be useless. Re-running it updates in place; it never duplicates.
 * The audit trigger records every row it writes with `seed` as the actor.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";
import { loadConfig } from "../config";
import * as schema from "./schema";
import { seedBuilding, seedOrgUnits, seedRoleMappings, seedUsers } from "./seed-data";
import { seedContractRegister } from "./seed-contracts";
import { seedProjectRegister } from "./seed-projects";

export interface SeedSummary {
  orgUnits: number;
  aliases: number;
  buildings: number;
  floors: number;
  areas: number;
  users: number;
  roleMappings: number;
  projects: number;
  milestones: number;
  risks: number;
  issues: number;
  contractors: number;
  contracts: number;
  boqItems: number;
  variations: number;
}

export async function seed(databaseUrl: string): Promise<SeedSummary> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const db = drizzle(client, { schema });
  try {
    await client.query("select set_config('app.user_id', 'seed', false)");

    for (const unit of seedOrgUnits) {
      await db
        .insert(schema.orgUnit)
        .values({
          id: unit.id,
          code: unit.code,
          nameEl: unit.nameEl,
          nameEn: unit.nameEn,
          type: unit.type,
          directorate: unit.directorate,
          costCentre: unit.costCentre,
          timezone: unit.timezone,
        })
        .onConflictDoUpdate({
          target: schema.orgUnit.id,
          set: {
            code: unit.code,
            nameEl: unit.nameEl,
            nameEn: unit.nameEn,
            type: unit.type,
            directorate: unit.directorate,
            costCentre: unit.costCentre,
            updatedAt: sql`now()`,
          },
        });
    }

    let aliases = 0;
    for (const unit of seedOrgUnits) {
      for (const alias of unit.aliases) {
        await db
          .insert(schema.orgUnitAlias)
          .values({ orgUnitId: unit.id, alias })
          .onConflictDoUpdate({
            target: schema.orgUnitAlias.alias,
            set: { orgUnitId: unit.id },
          });
        aliases += 1;
      }
    }

    const [buildingRow] = await db
      .insert(schema.building)
      .values({
        orgUnitId: seedBuilding.orgUnitId,
        code: seedBuilding.code,
        nameEl: seedBuilding.nameEl,
        grossAreaM2: seedBuilding.grossAreaM2,
        yearBuilt: seedBuilding.yearBuilt,
        storeys: seedBuilding.storeys,
      })
      .onConflictDoUpdate({
        target: [schema.building.orgUnitId, schema.building.code],
        set: { nameEl: seedBuilding.nameEl, updatedAt: sql`now()` },
      })
      .returning({ id: schema.building.id });

    let floors = 0;
    let areas = 0;
    for (const floor of seedBuilding.floors) {
      const [floorRow] = await db
        .insert(schema.floor)
        .values({
          buildingId: buildingRow.id,
          // The trigger overwrites this from the parent building; it is here
          // because the column is NOT NULL.
          orgUnitId: seedBuilding.orgUnitId,
          code: floor.code,
          nameEl: floor.nameEl,
          level: floor.level,
        })
        .onConflictDoUpdate({
          target: [schema.floor.buildingId, schema.floor.code],
          set: { nameEl: floor.nameEl, level: floor.level, updatedAt: sql`now()` },
        })
        .returning({ id: schema.floor.id });
      floors += 1;

      for (const area of floor.areas) {
        await db
          .insert(schema.area)
          .values({
            floorId: floorRow.id,
            orgUnitId: seedBuilding.orgUnitId,
            code: area.code,
            nameEl: area.nameEl,
            areaType: area.areaType,
            patientRiskGroup: area.patientRiskGroup,
            costCentre: area.costCentre,
            beds: area.beds,
          })
          .onConflictDoUpdate({
            target: [schema.area.floorId, schema.area.code],
            set: {
              nameEl: area.nameEl,
              areaType: area.areaType,
              patientRiskGroup: area.patientRiskGroup,
              costCentre: area.costCentre,
              beds: area.beds,
              updatedAt: sql`now()`,
            },
          });
        areas += 1;
      }
    }

    for (const user of seedUsers) {
      const [userRow] = await db
        .insert(schema.appUser)
        .values({ subject: user.subject, name: user.name, email: user.email })
        .onConflictDoUpdate({
          target: schema.appUser.subject,
          set: { name: user.name, email: user.email, isActive: true, updatedAt: sql`now()` },
        })
        .returning({ id: schema.appUser.id });

      await db
        .delete(schema.appUserRole)
        .where(sql`${schema.appUserRole.appUserId} = ${userRow.id}`);
      for (const role of user.roles) {
        await db.insert(schema.appUserRole).values({ appUserId: userRow.id, role });
      }

      await db
        .delete(schema.appUserOrgUnit)
        .where(sql`${schema.appUserOrgUnit.appUserId} = ${userRow.id}`);
      for (const orgUnitId of user.orgUnitIds) {
        await db.insert(schema.appUserOrgUnit).values({ appUserId: userRow.id, orgUnitId });
      }
    }

    for (const mapping of seedRoleMappings) {
      await db
        .insert(schema.roleMapping)
        .values({
          entraGroupId: mapping.entraGroupId,
          role: mapping.role,
          orgUnitId: mapping.orgUnitId,
          note: mapping.note,
        })
        .onConflictDoNothing();
    }

    // M1: the project register, after the users, because a project points at
    // a sponsor and a manager.
    const register = await seedProjectRegister(db);

    // M1: the contract register, after the projects, because a contract hangs
    // off a project and takes its org unit from it.
    const contracts = await seedContractRegister(db);

    return {
      orgUnits: seedOrgUnits.length,
      aliases,
      buildings: 1,
      floors,
      areas,
      users: seedUsers.length,
      roleMappings: seedRoleMappings.length,
      ...register,
      ...contracts,
    };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const config = loadConfig();
  seed(config.migrationDatabaseUrl)
    .then((s) => {
      console.log(
        `seed: ${s.orgUnits} org units, ${s.aliases} aliases, ${s.buildings} building, ` +
          `${s.floors} floors, ${s.areas} areas, ${s.users} users, ${s.roleMappings} role mappings, ` +
          `${s.projects} projects, ${s.milestones} milestones, ${s.risks} risks, ${s.issues} issues, ` +
          `${s.contractors} contractors, ${s.contracts} contracts, ${s.boqItems} bill lines, ` +
          `${s.variations} variations`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
