/**
 * The contract half of the seed: twelve contractors, one contract on every
 * project that has been awarded, a short bill of quantities on three of them
 * and the variations that give R10's workflow and R31's warnings something
 * real to work on (R08, R10, R13, R31, CAPEX-01 §15).
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security — a seed that could only see its own units
 * would be useless. Re-running updates in place and never duplicates: a
 * contractor is found again by name, a contract by unit plus contract number,
 * a bill line by contract plus item number and a variation by contract plus
 * its number.
 *
 * The variation numbers are written out here rather than allocated, because
 * the fixture says which variation is which; the API allocates them through
 * ecapital.allocate_variation_number, and the unique index on
 * (contract_id, number) is what keeps the two honest with each other.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import {
  seedBoqItems,
  seedBoqProjects,
  seedContractPhases,
  seedContractors,
  seedExpiredBond,
  seedProjects,
  seedVariations,
  type SeedProject,
} from "./seed-data";

type Db = NodePgDatabase<typeof schema>;

export interface ContractSeedSummary {
  contractors: number;
  contracts: number;
  boqItems: number;
  variations: number;
}

/** The contract type that suits the kind of work the project is. */
const TYPE_BY_CATEGORY = {
  NEW_BUILD: "LUMP_SUM",
  RENOVATION: "BOQ",
  SMALL_WORKS: "LUMP_SUM",
  EQUIPMENT: "SUPPLY",
  MAINTENANCE_CAPITAL: "MEASURE_TERM",
  IT: "SERVICE",
} as const;

/** Which kind of firm takes which kind of work. */
const CONTRACTOR_CATEGORY_BY_PROJECT = {
  NEW_BUILD: ["BUILDING"],
  RENOVATION: ["BUILDING"],
  SMALL_WORKS: ["BUILDING"],
  EQUIPMENT: ["BIOMEDICAL"],
  MAINTENANCE_CAPITAL: ["MECHANICAL", "ELECTRICAL"],
  IT: ["IT"],
} as const;

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The contract as the fixture says it is. The original value is 85–100% of
 * the approved budget, dealt out by position so the register looks the same
 * on every machine: a contract awarded below its budget is the ordinary case
 * and one awarded at the budget is the tight one.
 */
export function contractFor(
  project: SeedProject,
  index: number,
): {
  contractNo: string;
  type: (typeof TYPE_BY_CATEGORY)[keyof typeof TYPE_BY_CATEGORY];
  awardDate: string;
  startDate: string;
  completionDate: string;
  originalValue: number;
  retentionPct: number;
  performanceBondValue: number;
  bondExpiry: string | null;
  liquidatedDamagesPerDay: number;
  defectsLiabilityMonths: number;
  sapPoNumber: string;
} {
  const base = project.plannedStart ?? project.plannedFinish ?? "2026-01-15";
  const awardDate = addDays(base, -21);
  const startDate = base;
  const completionDate = project.plannedFinish ?? addDays(base, 365);
  const originalValue = round2(project.approvedBudget * (0.85 + (index % 16) / 100));

  // The bond is returned once the works are over, so a contract whose
  // completion is well behind us carries none — except the one the fixture
  // deliberately left to lapse (see seedExpiredBond).
  const ninetyDaysOn = addDays(completionDate, 90);
  const bondExpiry =
    project.ref === seedExpiredBond.projectRef
      ? seedExpiredBond.bondExpiry
      : ninetyDaysOn > "2026-12-31"
        ? ninetyDaysOn
        : null;

  return {
    contractNo: `ΤΥ/2026/${String(index + 1).padStart(3, "0")}`,
    type: TYPE_BY_CATEGORY[project.category],
    awardDate,
    startDate,
    completionDate,
    originalValue,
    retentionPct: 5,
    performanceBondValue: round2(originalValue * 0.1),
    bondExpiry,
    liquidatedDamagesPerDay: round2(originalValue * 0.0005),
    defectsLiabilityMonths: 12,
    sapPoNumber: `45${String(100000 + index)}`,
  };
}

export async function seedContractRegister(db: Db): Promise<ContractSeedSummary> {
  const summary: ContractSeedSummary = {
    contractors: 0,
    contracts: 0,
    boqItems: 0,
    variations: 0,
  };

  // ------------------------------------------------------------ suppliers --
  const contractorIds = new Map<string, string>();
  const byCategory = new Map<string, string[]>();
  for (const fixture of seedContractors) {
    const [row] = await db
      .insert(schema.contractor)
      .values({
        name: fixture.name,
        vatNumber: fixture.vatNumber,
        registrationNo: fixture.registrationNo,
        category: fixture.category,
        sapVendorId: fixture.sapVendorId,
        blacklisted: fixture.blacklisted,
      })
      .onConflictDoUpdate({
        target: schema.contractor.name,
        set: {
          vatNumber: fixture.vatNumber,
          registrationNo: fixture.registrationNo,
          category: fixture.category,
          sapVendorId: fixture.sapVendorId,
          blacklisted: fixture.blacklisted,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: schema.contractor.id });
    contractorIds.set(fixture.name, row.id);
    summary.contractors += 1;
    // A blacklisted firm takes no new work, so it is not in the pool the
    // seeded contracts are dealt from.
    if (!fixture.blacklisted) {
      const pool = byCategory.get(fixture.category) ?? [];
      pool.push(row.id);
      byCategory.set(fixture.category, pool);
    }
  }

  // Who raised and who decided each seeded variation. R10 needs two different
  // people, and the CHECK in migration 0003 refuses the row otherwise, so the
  // seed picks the unit's own engineer or head of estates as the raiser and
  // Central Administration as the approver — which is how it works on paper.
  const users = await db
    .select({ id: schema.appUser.id, subject: schema.appUser.subject })
    .from(schema.appUser);
  const userBySubject = new Map(users.map((u) => [u.subject, u.id]));

  const projectIds = new Map<string, { id: string; orgUnitId: string }>();
  const contractIds = new Map<string, string>();

  // ------------------------------------------------------------ contracts --
  let position = 0;
  for (const project of seedProjects) {
    if (!(seedContractPhases as readonly string[]).includes(project.phase)) continue;

    const found = await db
      .select({ id: schema.project.id, orgUnitId: schema.project.orgUnitId })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.orgUnitId, project.orgUnitId),
          eq(schema.project.titleEl, project.titleEl),
        ),
      )
      .limit(1);
    if (!found.length) continue;
    projectIds.set(project.ref, found[0]);

    const fixture = contractFor(project, position);
    position += 1;

    const pool = CONTRACTOR_CATEGORY_BY_PROJECT[project.category]
      .flatMap((category) => byCategory.get(category) ?? []);
    const contractorId = pool[position % pool.length];

    const values = {
      contractorId,
      type: fixture.type,
      awardDate: fixture.awardDate,
      originalValue: String(fixture.originalValue),
      startDate: fixture.startDate,
      completionDate: fixture.completionDate,
      extensionDays: 0,
      retentionPct: String(fixture.retentionPct),
      performanceBondValue: String(fixture.performanceBondValue),
      bondExpiry: fixture.bondExpiry,
      liquidatedDamagesPerDay: String(fixture.liquidatedDamagesPerDay),
      defectsLiabilityMonths: fixture.defectsLiabilityMonths,
      sapPoNumber: fixture.sapPoNumber,
      updatedAt: sql`now()`,
    };

    const existing = await db
      .select({ id: schema.contract.id })
      .from(schema.contract)
      .where(
        and(
          eq(schema.contract.orgUnitId, project.orgUnitId),
          eq(schema.contract.contractNo, fixture.contractNo),
        ),
      )
      .limit(1);

    let contractId: string;
    if (existing.length) {
      contractId = existing[0].id;
      await db.update(schema.contract).set(values).where(eq(schema.contract.id, contractId));
    } else {
      const [inserted] = await db
        .insert(schema.contract)
        .values({
          ...values,
          projectId: found[0].id,
          orgUnitId: project.orgUnitId,
          // ADR-0019: allocated by the database, exactly as the API allocates
          // it on POST — the unique constraint on ref is what keeps the seed
          // and the API honest with each other, the same way the unique index
          // on (contract_id, number) does for variation numbers.
          ref: sql`ecapital.allocate_contract_ref(${Number(fixture.awardDate.slice(0, 4))})`,
          contractNo: fixture.contractNo,
          // Derived by the trigger from the approved variations; whatever
          // goes in here is overwritten before the row lands.
          currentValue: String(fixture.originalValue),
        })
        .returning({ id: schema.contract.id });
      contractId = inserted.id;
    }
    contractIds.set(project.ref, contractId);
    summary.contracts += 1;

    // ------------------------------------------------------- bill of quantities --
    if (seedBoqProjects.includes(project.ref)) {
      for (const item of seedBoqItems) {
        const line = await db
          .select({ id: schema.boqItem.id })
          .from(schema.boqItem)
          .where(
            and(eq(schema.boqItem.contractId, contractId), eq(schema.boqItem.itemNo, item.itemNo)),
          )
          .limit(1);
        if (line.length) {
          await db
            .update(schema.boqItem)
            .set({
              descriptionEl: item.descriptionEl,
              unit: item.unit,
              qty: String(item.qty),
              rate: String(item.rate),
              updatedAt: sql`now()`,
            })
            .where(eq(schema.boqItem.id, line[0].id));
        } else {
          await db.insert(schema.boqItem).values({
            contractId,
            orgUnitId: project.orgUnitId,
            itemNo: item.itemNo,
            descriptionEl: item.descriptionEl,
            unit: item.unit,
            qty: String(item.qty),
            rate: String(item.rate),
          });
        }
        summary.boqItems += 1;
      }
    }
  }

  // ----------------------------------------------------------- variations --
  const approver = userBySubject.get("dev-admin") ?? null;
  for (const fixture of seedVariations) {
    const contractId = contractIds.get(fixture.projectRef);
    const project = projectIds.get(fixture.projectRef);
    if (!contractId || !project || !approver) continue;

    const raiser = raiserFor(project.orgUnitId, userBySubject);
    if (!raiser || raiser === approver) continue;

    const [contract] = await db
      .select({ originalValue: schema.contract.originalValue })
      .from(schema.contract)
      .where(eq(schema.contract.id, contractId))
      .limit(1);
    const value = round2((Number(contract.originalValue) * fixture.valuePct) / 100);

    const decided = ["APPROVED", "RETURNED", "REJECTED"].includes(fixture.status);
    const values = {
      descriptionEl: fixture.descriptionEl,
      reason: fixture.reason,
      value: String(value),
      timeImpactDays: fixture.timeImpactDays,
      status: fixture.status,
      raisedBy: raiser,
      decidedBy: decided ? approver : null,
      decidedAt: decided ? sql`now()` : null,
      decisionCommentEl: fixture.commentEl,
      updatedAt: sql`now()`,
    };

    const existing = await db
      .select({ id: schema.variation.id })
      .from(schema.variation)
      .where(
        and(
          eq(schema.variation.contractId, contractId),
          eq(schema.variation.number, fixture.number),
        ),
      )
      .limit(1);

    if (existing.length) {
      await db.update(schema.variation).set(values).where(eq(schema.variation.id, existing[0].id));
    } else {
      await db.insert(schema.variation).values({
        ...values,
        contractId,
        orgUnitId: project.orgUnitId,
        number: fixture.number,
      });
    }
    summary.variations += 1;
  }

  return summary;
}

/**
 * Who raises a variation in a unit: its own project engineer where it has
 * one, otherwise its head of estates. Both are the people who would actually
 * write one (CAPEX-01 §1), and neither of them is the administrator who
 * decides it, which is what R10 asks for.
 */
function raiserFor(orgUnitId: string, userBySubject: Map<string, string>): string | null {
  const byUnit: Record<string, string> = {
    "larnaca-general": "dev-engineer-larnaca",
    "nicosia-general": "dev-estates-nicosia",
  };
  const subject = byUnit[orgUnitId];
  return subject ? (userBySubject.get(subject) ?? null) : null;
}
