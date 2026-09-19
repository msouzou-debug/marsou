/**
 * The M3 half of the seed: the ICRA matrix, the system feeds, who approves
 * what, and eight permits across the states a screen has to draw (R19–R25,
 * CAPEX-01 §15).
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security — a seed that could only see its own units
 * would be useless, and a permit seeded straight into CLINICAL_REVIEW would
 * otherwise need somebody to be signed in as three different people.
 *
 * Re-running updates in place and never duplicates: a matrix version is found
 * by its id, a feed by its unit, system and label, a permit by its title
 * within its unit — which the fixture keeps unique for exactly that reason.
 *
 * The windows are relative to the moment the seed runs, because «starts
 * tomorrow», «running now» and «overdue» are facts about the clock. A fixed
 * date would be a breach in October and ancient history by Christmas.
 *
 * NO PATIENT DATA. Rooms, systems, times and staff names, and nothing else.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { evaluate } from "../icra/icra-engine";
import { ilsmFor } from "../permits/ilsm";
import { findClashes, type ClashCandidate } from "../permits/clashes";
import { approvalSlaWindow } from "../permits/permit-sla";
import { durationHours, routeFor } from "../permits/routing";
import * as schema from "./schema";
import {
  type SeedPermit,
  seedAreaOwners,
  seedIcraCells,
  seedIcraMatrixVersion,
  seedLarnacaBuilding,
  seedPermits,
  seedSystemFeeds,
  seedUnitApprovers,
} from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

type AreaRow = typeof schema.area.$inferSelect;
type ApprovalRoleValue = typeof schema.permitApproval.$inferSelect["role"];

interface SeedAreaFact {
  id: string;
  code: string;
  orgUnitId: string;
  nameEl: string;
  areaType: AreaRow["areaType"];
  patientRiskGroup: AreaRow["patientRiskGroup"];
}

export interface PermitSeedSummary {
  icraMatrixCells: number;
  systemFeeds: number;
  permits: number;
  permitApprovals: number;
  areaOwners: number;
  unitApprovers: number;
}

const HOUR_MS = 3_600_000;

/** The threshold the routing uses. The seed does not read the environment. */
const DIRECTOR_THRESHOLD_HOURS = 72;

export async function seedPermitRegister(db: Db): Promise<PermitSeedSummary> {
  const summary: PermitSeedSummary = {
    icraMatrixCells: 0,
    systemFeeds: 0,
    permits: 0,
    permitApprovals: 0,
    areaOwners: 0,
    unitApprovers: 0,
  };
  // RULE (review nit, 19/09/2026): rounded to the whole hour rather than the
  // millisecond the seed happens to run at. Europe/Nicosia sits on a whole
  // hour offset from UTC year-round (+2 EET, +3 EEST), so a UTC timestamp on
  // the hour is also on the hour locally — every window below still reads as
  // something a person would type, e.g. 08:00–16:00, not 22:44:39.451.
  const nowOnTheHour = new Date();
  nowOnTheHour.setUTCMinutes(0, 0, 0);
  const now = nowOnTheHour.getTime();

  // ------------------------------------------------------- the matrix, R20 --
  await db
    .insert(schema.icraMatrixVersion)
    .values({
      id: seedIcraMatrixVersion.id,
      basedOn: seedIcraMatrixVersion.basedOn,
      effectiveFrom: seedIcraMatrixVersion.effectiveFrom,
      approvedByName: seedIcraMatrixVersion.approvedByName,
      notesEl: seedIcraMatrixVersion.notesEl,
      status: "ACTIVE",
    })
    .onConflictDoUpdate({
      target: schema.icraMatrixVersion.id,
      set: {
        basedOn: seedIcraMatrixVersion.basedOn,
        effectiveFrom: seedIcraMatrixVersion.effectiveFrom,
        notesEl: seedIcraMatrixVersion.notesEl,
        status: "ACTIVE",
        updatedAt: sql`now()`,
      },
    });

  for (const cell of seedIcraCells) {
    await db
      .insert(schema.icraMatrixCell)
      .values({
        versionId: seedIcraMatrixVersion.id,
        activityType: cell.activityType,
        riskGroup: cell.riskGroup,
        icraClass: cell.icraClass,
        controls: cell.controls,
      })
      .onConflictDoUpdate({
        target: [
          schema.icraMatrixCell.versionId,
          schema.icraMatrixCell.activityType,
          schema.icraMatrixCell.riskGroup,
        ],
        set: { icraClass: cell.icraClass, controls: cell.controls, updatedAt: sql`now()` },
      });
    summary.icraMatrixCells += 1;
  }

  // ------------------------------------------------- a second unit's estate --
  const [larnacaBuilding] = await db
    .insert(schema.building)
    .values({
      orgUnitId: seedLarnacaBuilding.orgUnitId,
      code: seedLarnacaBuilding.code,
      nameEl: seedLarnacaBuilding.nameEl,
      grossAreaM2: seedLarnacaBuilding.grossAreaM2,
      yearBuilt: seedLarnacaBuilding.yearBuilt,
      storeys: seedLarnacaBuilding.storeys,
    })
    .onConflictDoUpdate({
      target: [schema.building.orgUnitId, schema.building.code],
      set: { nameEl: seedLarnacaBuilding.nameEl, updatedAt: sql`now()` },
    })
    .returning({ id: schema.building.id });

  for (const floor of seedLarnacaBuilding.floors) {
    const [floorRow] = await db
      .insert(schema.floor)
      .values({
        buildingId: larnacaBuilding.id,
        orgUnitId: seedLarnacaBuilding.orgUnitId,
        code: floor.code,
        nameEl: floor.nameEl,
        level: floor.level,
      })
      .onConflictDoUpdate({
        target: [schema.floor.buildingId, schema.floor.code],
        set: { nameEl: floor.nameEl, level: floor.level, updatedAt: sql`now()` },
      })
      .returning({ id: schema.floor.id });

    for (const area of floor.areas) {
      await db
        .insert(schema.area)
        .values({
          floorId: floorRow.id,
          orgUnitId: seedLarnacaBuilding.orgUnitId,
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
            updatedAt: sql`now()`,
          },
        });
    }
  }

  // Every area of the two seeded buildings, by unit and code.
  const areaRows = await db
    .select({
      id: schema.area.id,
      code: schema.area.code,
      orgUnitId: schema.area.orgUnitId,
      nameEl: schema.area.nameEl,
      areaType: schema.area.areaType,
      patientRiskGroup: schema.area.patientRiskGroup,
    })
    .from(schema.area);
  const areaByKey = new Map(areaRows.map((row) => [`${row.orgUnitId}:${row.code}`, row]));
  const areaById = new Map(areaRows.map((row) => [row.id, row]));
  const areaId = (orgUnitId: string, code: string): string => {
    const row = areaByKey.get(`${orgUnitId}:${code}`);
    if (!row) throw new Error(`seed: no area ${code} in ${orgUnitId}`);
    return row.id;
  };

  // --------------------------------------------------- the feeds, R19 §6.1 --
  for (const feed of seedSystemFeeds) {
    const values = {
      orgUnitId: feed.orgUnitId,
      system: feed.system,
      sourceAreaId: feed.sourceAreaCode ? areaId(feed.orgUnitId, feed.sourceAreaCode) : null,
      servesAreaIds: feed.servesAreaCodes.map((code) => areaId(feed.orgUnitId, code)),
      labelEl: feed.labelEl,
    };
    const existing = await db
      .select({ id: schema.systemFeed.id })
      .from(schema.systemFeed)
      .where(
        and(
          eq(schema.systemFeed.orgUnitId, feed.orgUnitId),
          eq(schema.systemFeed.labelEl, feed.labelEl),
        ),
      )
      .limit(1);
    if (existing.length) {
      await db
        .update(schema.systemFeed)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.systemFeed.id, existing[0].id));
    } else {
      await db.insert(schema.systemFeed).values(values);
    }
    summary.systemFeeds += 1;
  }

  // --------------------------------------------------- who approves what --
  const users = await db
    .select({ id: schema.appUser.id, email: schema.appUser.email })
    .from(schema.appUser);
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));
  const userId = (email: string): string => {
    const id = userByEmail.get(email);
    if (!id) throw new Error(`seed: no user ${email}`);
    return id;
  };

  for (const appointment of seedUnitApprovers) {
    await db
      .insert(schema.unitApprover)
      .values({
        orgUnitId: appointment.orgUnitId,
        userId: userId(appointment.email),
        approvalRole: appointment.approvalRole,
      })
      .onConflictDoNothing();
    summary.unitApprovers += 1;
  }

  for (const owner of seedAreaOwners) {
    await db
      .insert(schema.areaClinicalOwner)
      .values({
        areaId: areaId(owner.orgUnitId, owner.areaCode),
        userId: userId(owner.email),
        orgUnitId: owner.orgUnitId,
        approvalRole: owner.approvalRole,
      })
      .onConflictDoNothing();
    summary.areaOwners += 1;
  }

  // ------------------------------------------------------------ the permits --
  const matrix = {
    id: seedIcraMatrixVersion.id,
    basedOn: seedIcraMatrixVersion.basedOn,
    effectiveFrom: seedIcraMatrixVersion.effectiveFrom,
    approvedByName: null,
    approvedAt: null,
    status: "ACTIVE" as const,
    notesEl: seedIcraMatrixVersion.notesEl,
    cells: seedIcraCells,
  };

  for (const fixture of seedPermits) {
    const existing = await db
      .select({ id: schema.shutdownPermit.id })
      .from(schema.shutdownPermit)
      .where(
        and(
          eq(schema.shutdownPermit.orgUnitId, fixture.orgUnitId),
          eq(schema.shutdownPermit.titleEl, fixture.titleEl),
        ),
      )
      .limit(1);
    // A permit is a decision somebody took; re-running the seed leaves the
    // one that is already there alone rather than rewriting its history.
    if (existing.length) {
      summary.permits += 1;
      continue;
    }

    await writePermit(db, fixture, {
      now,
      matrix,
      areaId,
      areaById,
      requestedBy: userId(fixture.requestedByEmail),
      summary,
    });
    summary.permits += 1;
  }

  return summary;
}

interface WriteContext {
  now: number;
  matrix: Parameters<typeof evaluate>[0]["matrix"];
  areaId: (orgUnitId: string, code: string) => string;
  areaById: Map<string, SeedAreaFact>;
  requestedBy: string;
  summary: PermitSeedSummary;
}

/**
 * One permit, written straight into the state the fixture asks for.
 *
 * It walks the same rules the service walks — the impact resolver, the ICRA
 * engine, the ILSM check, the route, the clash detector — rather than
 * hand-writing the answers, so a seeded database and a database somebody
 * clicked through look identical. If a rule changes, the seed moves with it.
 */
async function writePermit(
  db: Db,
  fixture: SeedPermit,
  context: WriteContext,
): Promise<void> {
  const start = new Date(context.now + fixture.startInHours * HOUR_MS);
  const end = new Date(context.now + fixture.endInHours * HOUR_MS);

  // §6.1: the direct areas, plus whatever the feeds say is downstream.
  const direct = fixture.areaCodes.map((code) => context.areaId(fixture.orgUnitId, code));
  const feeds = await db
    .select()
    .from(schema.systemFeed)
    .where(
      and(
        eq(schema.systemFeed.orgUnitId, fixture.orgUnitId),
        inArray(schema.systemFeed.system, fixture.systems),
      ),
    );
  const indirect = new Map<string, (typeof fixture.systems)[number]>();
  for (const feed of feeds) {
    if (feed.sourceAreaId !== null && !direct.includes(feed.sourceAreaId)) continue;
    for (const served of feed.servesAreaIds) {
      if (!direct.includes(served) && !indirect.has(served)) indirect.set(served, feed.system);
    }
  }

  const ilsm = ilsmFor(fixture.ilsmTriggers, fixture.systems);
  const everyAreaId = [...direct, ...indirect.keys()];
  const icra =
    fixture.target === "DRAFT"
      ? null
      : evaluate({
          activityType: fixture.activityType,
          workKind: fixture.workKind,
          areas: everyAreaId.map((id) => ({
            id,
            patientRiskGroup: context.areaById.get(id)?.patientRiskGroup ?? "LOW",
          })),
          surrounding: [],
          matrix: context.matrix,
        });
  if (icra?.refusalKey) {
    // A fixture the wizard would refuse is a fixture nobody could have
    // created, and a seeded database that holds one is lying about the rules.
    throw new Error(`seed: permit ${fixture.key} would be refused (${icra.refusalKey})`);
  }

  const settled = fixture.target !== "DRAFT";
  const ref = settled
    ? (
        await db
          .select({
            ref: sql<string>`ecapital.allocate_permit_ref(${fixture.orgUnitId}, ${new Date(context.now).getUTCFullYear()}::int)`,
          })
          .from(sql`(select 1) as one`)
      )[0].ref
    : null;

  const [permit] = await db
    .insert(schema.shutdownPermit)
    .values({
      ref,
      orgUnitId: fixture.orgUnitId,
      titleEl: fixture.titleEl,
      descriptionEl: fixture.descriptionEl,
      workKind: fixture.workKind,
      systems: fixture.systems,
      plannedStart: start,
      plannedEnd: end,
      icra,
      icraClass: icra?.icraClass ?? null,
      ilsm,
      contingencyPlanEl: fixture.contingencyPlanEl,
      status: "DRAFT",
      requestedBy: context.requestedBy,
      requestedAt: new Date(context.now - 48 * HOUR_MS),
    })
    .returning({ id: schema.shutdownPermit.id });

  for (const id of direct) {
    await db.insert(schema.shutdownPermitArea).values({
      permitId: permit.id,
      areaId: id,
      orgUnitId: fixture.orgUnitId,
      impact: "DIRECT",
      viaSystem: null,
    });
  }
  for (const [id, system] of indirect) {
    await db.insert(schema.shutdownPermitArea).values({
      permitId: permit.id,
      areaId: id,
      orgUnitId: fixture.orgUnitId,
      impact: "INDIRECT",
      viaSystem: system,
    });
  }

  if (fixture.target === "DRAFT") return;

  // §6.7: the clash detector, over everything already seeded in the unit.
  const clashes = await clashesFor(db, permit.id, fixture, everyAreaId, context, start, end);

  // §6.4: the route, from the class, the areas and the duration.
  const lines = routeFor({
    icraClass: icra!.icraClass,
    areas: everyAreaId.map((id) => {
      const area = context.areaById.get(id);
      return {
        areaId: id,
        areaNameEl: area?.nameEl ?? "",
        areaType: area?.areaType ?? "OTHER",
      };
    }),
    ilsmRequired: ilsm.required,
    durationHours: durationHours(start, end),
    directorThresholdHours: DIRECTOR_THRESHOLD_HOURS,
  });

  const submittedAt = new Date(context.now - 24 * HOUR_MS);
  const sla = approvalSlaWindow(submittedAt);
  // Everything except the M3 definition-of-done permit is signed off; that
  // one is left with its lines pending, which is what S14 has to draw.
  const decideAll = fixture.target !== "CLINICAL_REVIEW";

  for (const line of lines) {
    const approverId = await resolveApprover(db, fixture.orgUnitId, line.role, line.areaId, context.requestedBy);
    await db.insert(schema.permitApproval).values({
      permitId: permit.id,
      orgUnitId: fixture.orgUnitId,
      role: line.role,
      reason: line.reason,
      areaId: line.areaId,
      approverId,
      decision: decideAll ? "APPROVED" : "PENDING",
      decidedAt: decideAll ? new Date(context.now - 12 * HOUR_MS) : null,
      dueAt: sla.dueAt,
      slaHours: sla.hours,
    });
    context.summary.permitApprovals += 1;
  }

  const approvedAt = decideAll ? new Date(context.now - 12 * HOUR_MS) : null;
  const patch: Record<string, unknown> = {
    status: fixture.target,
    submittedAt,
    approvedAt,
    clashes,
    updatedAt: sql`now()`,
  };

  if (fixture.target === "ACTIVE" || fixture.target === "BREACH" || fixture.target === "CLOSED") {
    patch.actualStart = start;
  }
  if (fixture.target === "BREACH") {
    patch.breachedAt = new Date(end.getTime() + HOUR_MS);
  }
  if (fixture.target === "CLOSED") {
    const acceptor = await acceptorFor(db, fixture.orgUnitId, everyAreaId);
    patch.actualEnd = end;
    patch.closedBy = acceptor?.id ?? context.requestedBy;
    patch.closedAt = end;
    patch.closeout = {
      barriersRemoved: true,
      areaCleaned: true,
      airBalanceRestored: true,
      systemsTestedAndReturned: true,
      fireSystemsReenabled: true,
      noteEl: "Ο χώρος παραδόθηκε καθαρός και τα συστήματα επανήλθαν σε λειτουργία.",
      clinicalAcceptanceById: acceptor?.id ?? null,
      clinicalAcceptanceByName: acceptor?.name ?? null,
      clinicalAcceptanceAt: end.toISOString(),
    };
  }

  await db
    .update(schema.shutdownPermit)
    .set(patch)
    .where(eq(schema.shutdownPermit.id, permit.id));
}

/** §6.7, against everything already in the unit whose window overlaps. */
async function clashesFor(
  db: Db,
  permitId: string,
  fixture: SeedPermit,
  areaIds: string[],
  context: WriteContext,
  start: Date,
  end: Date,
): Promise<unknown[]> {
  const rows = await db
    .select({
      id: schema.shutdownPermit.id,
      ref: schema.shutdownPermit.ref,
      orgUnitId: schema.shutdownPermit.orgUnitId,
      systems: schema.shutdownPermit.systems,
      start: schema.shutdownPermit.plannedStart,
      end: schema.shutdownPermit.plannedEnd,
    })
    .from(schema.shutdownPermit)
    .where(eq(schema.shutdownPermit.orgUnitId, fixture.orgUnitId));

  const areaLinks = await db
    .select({
      permitId: schema.shutdownPermitArea.permitId,
      areaId: schema.shutdownPermitArea.areaId,
    })
    .from(schema.shutdownPermitArea);

  const candidates: ClashCandidate[] = rows
    .filter((row) => row.id !== permitId)
    .map((row) => {
      const mine = areaLinks.filter((link) => link.permitId === row.id);
      return {
        id: row.id,
        ref: row.ref,
        orgUnitId: row.orgUnitId,
        systems: row.systems,
        areaIds: mine.map((link) => link.areaId),
        areaTypes: mine.map(
          (link) => context.areaById.get(link.areaId)?.areaType ?? "OTHER",
        ),
        start: row.start,
        end: row.end,
      };
    });

  return findClashes(
    {
      id: permitId,
      ref: null,
      orgUnitId: fixture.orgUnitId,
      systems: fixture.systems,
      areaIds,
      areaTypes: areaIds.map((id) => context.areaById.get(id)?.areaType ?? "OTHER"),
      start,
      end,
    },
    candidates,
  );
}

/** The same resolution the service does, so the seed routes to the same people. */
// RULE (ADR-0015's principle, ADR-0026): the requester never resolves as an
// approver of their own permit — same rule as PermitsService.resolveApprover,
// so the seeded demo permits behave like real ones.
async function resolveApprover(
  db: Db,
  orgUnitId: string,
  role: ApprovalRoleValue,
  areaId: string | null,
  excludeUserId: string | null = null,
): Promise<string | null> {
  const notRequester = (rows: Array<{ userId: string }>) => rows.find((r) => r.userId !== excludeUserId)?.userId ?? null;
  if (areaId) {
    const owners = await db
      .select({ userId: schema.areaClinicalOwner.userId })
      .from(schema.areaClinicalOwner)
      .where(
        and(
          eq(schema.areaClinicalOwner.areaId, areaId),
          eq(schema.areaClinicalOwner.approvalRole, role),
        ),
      );
    return notRequester(owners);
  }
  const unitWide = await db
    .select({ userId: schema.unitApprover.userId })
    .from(schema.unitApprover)
    .where(
      and(
        eq(schema.unitApprover.orgUnitId, orgUnitId),
        eq(schema.unitApprover.approvalRole, role),
      ),
    );
  const unitPick = notRequester(unitWide);
  if (unitPick) return unitPick;

  const byArea = await db
    .select({ userId: schema.areaClinicalOwner.userId })
    .from(schema.areaClinicalOwner)
    .where(
      and(
        eq(schema.areaClinicalOwner.orgUnitId, orgUnitId),
        eq(schema.areaClinicalOwner.approvalRole, role),
      ),
    );
  return notRequester(byArea);
}

/** §6.6: somebody who could have signed the clinical acceptance. */
async function acceptorFor(
  db: Db,
  orgUnitId: string,
  areaIds: string[],
): Promise<{ id: string; name: string } | null> {
  if (areaIds.length) {
    const owners = await db
      .select({ id: schema.appUser.id, name: schema.appUser.name })
      .from(schema.areaClinicalOwner)
      .innerJoin(schema.appUser, eq(schema.appUser.id, schema.areaClinicalOwner.userId))
      .where(inArray(schema.areaClinicalOwner.areaId, areaIds))
      .limit(1);
    if (owners.length) return owners[0];
  }
  const unitWide = await db
    .select({ id: schema.appUser.id, name: schema.appUser.name })
    .from(schema.unitApprover)
    .innerJoin(schema.appUser, eq(schema.appUser.id, schema.unitApprover.userId))
    .where(
      and(
        eq(schema.unitApprover.orgUnitId, orgUnitId),
        inArray(schema.unitApprover.approvalRole, ["NURSING", "INFECTION_CONTROL"]),
      ),
    )
    .limit(1);
  return unitWide[0] ?? null;
}
