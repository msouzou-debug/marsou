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

/**
 * ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract.
 * Picked sensibly by the project's own category, from the twenty codes
 * migration 0013 seeds — the five real ones where a category matches
 * cleanly (EQUIPMENT → medical equipment, MAINTENANCE_CAPITAL → air
 * conditioning, the kind of replacement CAPEX-03's own fixture rows are
 * usually about) and one of the fifteen placeholders otherwise, since the
 * real fifteen are not published yet.
 */
const BUDGET_CODE_BY_CATEGORY = {
  NEW_BUILD: "7401", // Κτίρια (placeholder)
  RENOVATION: "7561", // Ανακαινίσεις κτιρίων (placeholder)
  SMALL_WORKS: "7562", // Έργα υποδομής (placeholder)
  EQUIPMENT: "7402", // Ιατρικός και λοιπός εξοπλισμός (real)
  MAINTENANCE_CAPITAL: "7502", // Κλιματισμός (real)
  IT: "7404", // Ηλεκτρονικός εξοπλισμός και λογισμικό (placeholder)
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
      // ADR-0035: `extension_days` is the sum of the extension rows, kept by
      // the database; the seed never writes it.
      retentionPct: String(fixture.retentionPct),
      performanceBondValue: String(fixture.performanceBondValue),
      bondExpiry: fixture.bondExpiry,
      liquidatedDamagesPerDay: String(fixture.liquidatedDamagesPerDay),
      defectsLiabilityMonths: fixture.defectsLiabilityMonths,
      sapPoNumber: fixture.sapPoNumber,
      budgetCode: BUDGET_CODE_BY_CATEGORY[project.category],
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

  // ------------------------------------------------- ADR-0035 delay example --
  await seedDelayExample(db, contractIds, userBySubject);

  return summary;
}

/**
 * ADR-0035: the Larnaca shape the ΜΕΕ reported, on the seeded Larnaca
 * operating-theatre contract, so the UAT sees real figures: two sections at
 * €1.000 a day, Section Α handed over 282 days late and activated seven months
 * after its deadline, Section Β still open with one extension of 40 days from
 * the ΚΕΑΑ judged not the contractor's fault, and the claim in court. The
 * Organisation's counterclaim sits on the NAM III contract (the terminated
 * NICU contract of the report), or on the same contract when there is none.
 *
 * Idempotent: a section is found by contract and code, the extension by
 * section and approval date, a claim by contract and title.
 */
export const seedDelay = {
  projectRef: "PRJ-036",
  counterclaimProjectRef: "PRJ-029",
  ratePerDay: 1000,
  sections: [
    {
      code: "Α",
      titleEl: "Τμήμα Α — Χειρουργεία ισογείου",
      completionDate: "2024-12-03",
      handoverDate: "2025-09-11",
      ldActivatedAt: "2025-07-21",
      ldActivationNoteEl: "Ενεργοποίηση της ρήτρας καθυστέρησης μετά από απόφαση της Διεύθυνσης Τεχνικών Υπηρεσιών.",
      sortOrder: 1,
    },
    {
      code: "Β",
      titleEl: "Τμήμα Β — Χειρουργεία πρώτου ορόφου",
      completionDate: "2026-06-18",
      handoverDate: null,
      ldActivatedAt: null,
      ldActivationNoteEl: null,
      sortOrder: 2,
    },
  ],
  extension: {
    sectionCode: "Β",
    days: 40,
    approvedAt: "2026-05-28",
    approver: "KEAA" as const,
    approverNameEl: "Κεντρική Επιτροπή Αλλαγών και Απαιτήσεων",
    reasonEl: "Καθυστέρηση στην παράδοση εξοπλισμού ιατρικών αερίων από τρίτο προμηθευτή.",
    contractorCulpable: false,
  },
  claims: [
    {
      onCounterclaimContract: false,
      direction: "BY_CONTRACTOR" as const,
      titleEl: "Αξίωση αναδόχου για παράταση και πρόσθετο κόστος",
      amount: 2532848.76,
      stage: "COURT" as const,
      notifiedAt: "2025-10-15",
      legalAdvisorEl: "Νομική Υπηρεσία",
      contingentLiability: true,
      notesEl: "Ενδεχόμενη υποχρέωση για τις σημειώσεις των οικονομικών καταστάσεων.",
    },
    {
      onCounterclaimContract: true,
      direction: "BY_ORGANISATION" as const,
      titleEl: "Αξίωση Οργανισμού μετά τον τερματισμό της σύμβασης",
      amount: 2508506.69,
      stage: "COURT" as const,
      notifiedAt: "2025-11-20",
      legalAdvisorEl: "Νομική Υπηρεσία",
      contingentLiability: false,
      notesEl: "",
    },
  ],
} as const;

async function seedDelayExample(
  db: Db,
  contractIds: Map<string, string>,
  userBySubject: Map<string, string>,
): Promise<void> {
  const contractId = contractIds.get(seedDelay.projectRef);
  if (!contractId) return;
  const counterclaimContractId = contractIds.get(seedDelay.counterclaimProjectRef) ?? contractId;

  // The rate is the contract's; the sections carry none of their own.
  await db
    .update(schema.contract)
    .set({ liquidatedDamagesPerDay: String(seedDelay.ratePerDay) })
    .where(eq(schema.contract.id, contractId));

  const sectionIds = new Map<string, string>();
  for (const section of seedDelay.sections) {
    const values = {
      titleEl: section.titleEl,
      completionDate: section.completionDate,
      handoverDate: section.handoverDate,
      liquidatedDamagesPerDay: null,
      ldActivatedAt: section.ldActivatedAt,
      ldActivationNoteEl: section.ldActivationNoteEl,
      sortOrder: section.sortOrder,
    };
    const [found] = await db
      .select({ id: schema.contractSection.id })
      .from(schema.contractSection)
      .where(
        and(eq(schema.contractSection.contractId, contractId), eq(schema.contractSection.code, section.code)),
      )
      .limit(1);
    if (found) {
      await db.update(schema.contractSection).set(values).where(eq(schema.contractSection.id, found.id));
      sectionIds.set(section.code, found.id);
    } else {
      const [inserted] = await db
        .insert(schema.contractSection)
        .values({ ...values, contractId, orgUnitId: "", code: section.code })
        .returning({ id: schema.contractSection.id });
      sectionIds.set(section.code, inserted.id);
    }
  }

  const extension = seedDelay.extension;
  const sectionId = sectionIds.get(extension.sectionCode) ?? null;
  const [existing] = await db
    .select({ id: schema.contractExtension.id })
    .from(schema.contractExtension)
    .where(
      and(
        eq(schema.contractExtension.contractId, contractId),
        eq(schema.contractExtension.approvedAt, extension.approvedAt),
        eq(schema.contractExtension.days, extension.days),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(schema.contractExtension).values({
      contractId,
      orgUnitId: "",
      sectionId,
      days: extension.days,
      approvedAt: extension.approvedAt,
      approver: extension.approver,
      approverNameEl: extension.approverNameEl,
      reasonEl: extension.reasonEl,
      contractorCulpable: extension.contractorCulpable,
      createdBy: userBySubject.get("dev-engineer-larnaca") ?? null,
    });
  }

  for (const claim of seedDelay.claims) {
    const target = claim.onCounterclaimContract ? counterclaimContractId : contractId;
    const values = {
      direction: claim.direction,
      amount: String(claim.amount),
      stage: claim.stage,
      notifiedAt: claim.notifiedAt,
      legalAdvisorEl: claim.legalAdvisorEl,
      contingentLiability: claim.contingentLiability,
      notesEl: claim.notesEl,
    };
    const [found] = await db
      .select({ id: schema.contractClaim.id })
      .from(schema.contractClaim)
      .where(and(eq(schema.contractClaim.contractId, target), eq(schema.contractClaim.titleEl, claim.titleEl)))
      .limit(1);
    if (found) {
      await db.update(schema.contractClaim).set(values).where(eq(schema.contractClaim.id, found.id));
    } else {
      await db
        .insert(schema.contractClaim)
        .values({ ...values, contractId: target, orgUnitId: "", titleEl: claim.titleEl });
    }
  }
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
