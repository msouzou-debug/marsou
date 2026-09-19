/**
 * The site-log half of the seed: RFIs with their SLA clock running, site
 * instructions, and the defects R12 and R35 need something to count (R09,
 * R12, R35, CAPEX-01 §15).
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security — a seed that could only see its own units
 * would be useless. Re-running updates in place and never duplicates: an RFI
 * and an instruction are found again by contract plus number, a defect by its
 * description, which the fixture keeps unique for exactly that reason.
 *
 * The RFI dates are relative to the moment the seed runs, because the SLA
 * band is a fact about the clock and a fixed date would be GREEN in October
 * and BREACHED by Christmas. Everything else is fixed, so the register looks
 * the same on every machine.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { handoverDueDate } from "../defects/defect-rows";
import * as schema from "./schema";
import {
  type SeedDefect,
  type SeedRfi,
  type SeedSiteInstruction,
  seedFundedDefect,
  seedHandoverDefects,
  seedInspectionDefects,
  seedInstructionCostImpact,
  seedInstructionEveryContract,
  seedProjects,
  seedRfiBreached,
  seedRfiRed,
  seedRfisEveryContract,
} from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

export interface SiteSeedSummary {
  rfis: number;
  siteInstructions: number;
  defects: number;
}

const HOUR_MS = 3_600_000;

export async function seedSiteLog(db: Db): Promise<SiteSeedSummary> {
  const summary: SiteSeedSummary = { rfis: 0, siteInstructions: 0, defects: 0 };
  const now = Date.now();

  const users = await db
    .select({ id: schema.appUser.id, subject: schema.appUser.subject })
    .from(schema.appUser);
  const userBySubject = new Map(users.map((u) => [u.subject, u.id]));
  const admin = userBySubject.get("dev-admin");
  if (!admin) return summary;

  // Every seeded contract, found through the project the fixture names.
  const contracts = new Map<
    string,
    {
      id: string;
      orgUnitId: string;
      projectId: string;
      completionDate: string | null;
      extensionDays: number;
      defectsLiabilityMonths: number;
    }
  >();
  const projectIdByRef = new Map<string, string>();

  for (const project of seedProjects) {
    const found = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.orgUnitId, project.orgUnitId),
          eq(schema.project.titleEl, project.titleEl),
        ),
      )
      .limit(1);
    if (!found.length) continue;
    projectIdByRef.set(project.ref, found[0].id);

    const contract = await db
      .select({
        id: schema.contract.id,
        orgUnitId: schema.contract.orgUnitId,
        projectId: schema.contract.projectId,
        completionDate: schema.contract.completionDate,
        extensionDays: schema.contract.extensionDays,
        defectsLiabilityMonths: schema.contract.defectsLiabilityMonths,
      })
      .from(schema.contract)
      .where(eq(schema.contract.projectId, found[0].id))
      .limit(1);
    if (contract.length) contracts.set(project.ref, contract[0]);
  }

  // ------------------------------------------------------------------ RFIs --
  for (const [ref, contract] of contracts) {
    const author = authorFor(contract.orgUnitId, userBySubject) ?? admin;
    const fixtures = [...seedRfisEveryContract];
    if (ref === seedRfiBreached.projectRef) fixtures.push(seedRfiBreached.rfi);
    if (ref === seedRfiRed.projectRef) fixtures.push(seedRfiRed.rfi);

    for (const fixture of fixtures) {
      await upsertRfi(db, contract.id, contract.orgUnitId, author, fixture, now);
      summary.rfis += 1;
    }
  }

  // ---------------------------------------------------- site instructions --
  for (const [ref, contract] of contracts) {
    const author = authorFor(contract.orgUnitId, userBySubject) ?? admin;
    const fixtures: SeedSiteInstruction[] = [seedInstructionEveryContract];
    if (seedInstructionCostImpact.projectRefs.includes(ref)) {
      fixtures.push(seedInstructionCostImpact.instruction);
    }
    for (const fixture of fixtures) {
      await upsertInstruction(db, contract.id, contract.orgUnitId, author, fixture);
      summary.siteInstructions += 1;
    }
  }

  // --------------------------------------------------------------- defects --
  const fundedTarget = projectIdByRef.get(seedFundedDefect.targetProjectRef) ?? null;

  for (const group of seedHandoverDefects) {
    const contract = contracts.get(group.projectRef);
    if (!contract) continue;
    const author = authorFor(contract.orgUnitId, userBySubject) ?? admin;
    // R12: the same arithmetic the API uses when a handover defect is raised.
    const dueDate = handoverDueDate(
      contract.completionDate,
      contract.extensionDays,
      contract.defectsLiabilityMonths,
    );

    for (const fixture of group.defects) {
      const funded = fixture.funded && fundedTarget !== null;
      await upsertDefect(db, {
        fixture,
        source: "HANDOVER",
        orgUnitId: contract.orgUnitId,
        contractId: contract.id,
        projectId: contract.projectId,
        dueDate,
        funded,
        targetProjectId: funded ? fundedTarget : null,
        author,
      });
      summary.defects += 1;
    }
  }

  for (const entry of seedInspectionDefects) {
    const author = authorFor(entry.orgUnitId, userBySubject) ?? admin;
    await upsertDefect(db, {
      fixture: entry.defect,
      source: "INSPECTION",
      orgUnitId: entry.orgUnitId,
      contractId: null,
      projectId: null,
      // No contract, so no liability period and no due date (CAPEX-01 §4).
      dueDate: null,
      funded: false,
      targetProjectId: null,
      author,
    });
    summary.defects += 1;
  }

  return summary;
}

async function upsertRfi(
  db: Db,
  contractId: string,
  orgUnitId: string,
  author: string,
  fixture: SeedRfi,
  now: number,
): Promise<void> {
  const raisedAt = new Date(now - fixture.raisedHoursAgo * HOUR_MS);
  const slaHours = fixture.slaDays * 24;
  const answeredAt =
    fixture.answeredHoursAgo === null ? null : new Date(now - fixture.answeredHoursAgo * HOUR_MS);

  const values = {
    questionEl: fixture.questionEl,
    answerEl: fixture.answerEl,
    raisedBy: author,
    raisedAt,
    // RULE (ADR-0017): the answerer may be the raiser — an RFI is a question
    // to the ΟΚΥπΥ side and staff attach the reply. The seed says so plainly.
    answeredBy: answeredAt === null ? null : author,
    answeredAt,
    slaDueAt: new Date(raisedAt.getTime() + slaHours * HOUR_MS),
    slaHours,
    status: fixture.status,
    updatedAt: sql`now()`,
  };

  const existing = await db
    .select({ id: schema.rfi.id })
    .from(schema.rfi)
    .where(and(eq(schema.rfi.contractId, contractId), eq(schema.rfi.number, fixture.number)))
    .limit(1);

  if (existing.length) {
    await db.update(schema.rfi).set(values).where(eq(schema.rfi.id, existing[0].id));
  } else {
    await db
      .insert(schema.rfi)
      .values({ ...values, contractId, orgUnitId, number: fixture.number });
  }
}

async function upsertInstruction(
  db: Db,
  contractId: string,
  orgUnitId: string,
  author: string,
  fixture: SeedSiteInstruction,
): Promise<void> {
  const values = {
    textEl: fixture.textEl,
    costImpactFlag: fixture.costImpactFlag,
    issuedBy: author,
    updatedAt: sql`now()`,
  };

  const existing = await db
    .select({ id: schema.siteInstruction.id })
    .from(schema.siteInstruction)
    .where(
      and(
        eq(schema.siteInstruction.contractId, contractId),
        eq(schema.siteInstruction.number, fixture.number),
      ),
    )
    .limit(1);

  if (existing.length) {
    await db
      .update(schema.siteInstruction)
      .set(values)
      .where(eq(schema.siteInstruction.id, existing[0].id));
  } else {
    await db
      .insert(schema.siteInstruction)
      .values({ ...values, contractId, orgUnitId, number: fixture.number });
  }
}

interface DefectSeed {
  fixture: SeedDefect;
  source: "HANDOVER" | "INSPECTION";
  orgUnitId: string;
  contractId: string | null;
  projectId: string | null;
  dueDate: string | null;
  funded: boolean;
  targetProjectId: string | null;
  author: string;
}

async function upsertDefect(db: Db, input: DefectSeed): Promise<void> {
  const closed = input.fixture.status === "CLOSED";
  const values = {
    source: input.source,
    contractId: input.contractId,
    projectId: input.projectId,
    descriptionEl: input.fixture.descriptionEl,
    estimatedCost:
      input.fixture.estimatedCost === null ? null : String(input.fixture.estimatedCost),
    riskBand: input.fixture.riskBand,
    funded: input.funded,
    targetProjectId: input.targetProjectId,
    status: input.fixture.status,
    raisedBy: input.author,
    dueDate: input.dueDate,
    closedAt: closed ? sql`now()` : null,
    closedBy: closed ? input.author : null,
    updatedAt: sql`now()`,
  };

  const existing = await db
    .select({ id: schema.defect.id })
    .from(schema.defect)
    .where(eq(schema.defect.descriptionEl, input.fixture.descriptionEl))
    .limit(1);

  if (existing.length) {
    await db.update(schema.defect).set(values).where(eq(schema.defect.id, existing[0].id));
  } else {
    await db.insert(schema.defect).values({ ...values, orgUnitId: input.orgUnitId });
  }
}

/**
 * Who writes the site log in a unit: its own engineer or head of estates
 * where it has one, and the administrator everywhere else. The same shape as
 * the variation seed's `raiserFor`, with a fallback, because every unit has a
 * contract and not every unit has a named person in the fixture.
 */
function authorFor(orgUnitId: string, userBySubject: Map<string, string>): string | null {
  const byUnit: Record<string, string> = {
    "larnaca-general": "dev-engineer-larnaca",
    "nicosia-general": "dev-estates-nicosia",
  };
  const subject = byUnit[orgUnitId];
  return subject ? (userBySubject.get(subject) ?? null) : null;
}
