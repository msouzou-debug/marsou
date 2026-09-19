/**
 * The M2 half of the seed: the approved budget by year for all 41 projects,
 * a month of SAP postings already matched, a second month still waiting in
 * the unmatched queue, three payment certificates at three different points
 * of the workflow, two remembered allocation rules and two live warnings
 * (R11, R13, R14, R17, R18, R31, CAPEX-01 §15).
 *
 * OBVIOUSLY FAKE FIGURES, NO PATIENT DATA. The amounts are round numbers
 * dealt out by position, the SAP document numbers are sequential, and the
 * vendor names are the seeded contractors. Nothing here is a real posting.
 *
 * Run as the migration role, which owns the tables and is therefore not
 * filtered by row-level security. Re-running updates in place and never
 * duplicates: a budget line is found again by project, vintage and year, an
 * import batch by the hash it was given, a certificate by contract and
 * number, and the two batches' transactions are replaced whole.
 *
 * The two warnings are real: the project they are on carries a budget line
 * deliberately below what has been committed against it, so the same five
 * rules that fire on a live database fire on this one. Opening the cost
 * screen re-evaluates them and finds them still true, which is the point —
 * a seeded warning that vanished on first read would be a demo, not a test.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { I18nService } from "../common/i18n.service";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;

export interface CostSeedSummary {
  budgetLines: number;
  costTxns: number;
  importBatches: number;
  unmatchedRows: number;
  paymentCerts: number;
  allocationRules: number;
  costWarnings: number;
}

/** The revision the seeded budget lines belong to (CAPEX-03 §8). */
const VINTAGE = "2026-02";

/** The two seeded extracts, by the hash that identifies each file. */
const COMMITTED_BATCH_SHA = "a".repeat(64);
const PENDING_BATCH_SHA = "b".repeat(64);

/** A cost category per kind of project. One line per project, year and type. */
const CATEGORY_BY_PROJECT = {
  NEW_BUILD: "works",
  RENOVATION: "works",
  SMALL_WORKS: "works",
  EQUIPMENT: "equipment",
  MAINTENANCE_CAPITAL: "works",
  IT: "equipment",
  CAPITAL_WORKS: "works",
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

interface SeedProjectRow {
  id: string;
  code: string;
  orgUnitId: string;
  titleEl: string;
  category: keyof typeof CATEGORY_BY_PROJECT;
  approvedBudget: string;
  plannedStart: string | null;
  plannedFinish: string | null;
}

interface SeedContractRow {
  id: string;
  projectId: string;
  orgUnitId: string;
  ref: string;
  contractNo: string;
  contractorName: string;
  currentValue: string;
  startDate: string | null;
  awardDate: string;
  sapPoNumber: string | null;
  retentionPct: string;
}

export async function seedCostRegister(db: Db): Promise<CostSeedSummary> {
  const summary: CostSeedSummary = {
    budgetLines: 0,
    costTxns: 0,
    importBatches: 0,
    unmatchedRows: 0,
    paymentCerts: 0,
    allocationRules: 0,
    costWarnings: 0,
  };

  const projects = (await db
    .select({
      id: schema.project.id,
      code: schema.project.code,
      orgUnitId: schema.project.orgUnitId,
      titleEl: schema.project.titleEl,
      category: schema.project.category,
      approvedBudget: schema.project.approvedBudget,
      plannedStart: schema.project.plannedStart,
      plannedFinish: schema.project.plannedFinish,
    })
    .from(schema.project)
    .orderBy(schema.project.code)) as SeedProjectRow[];
  if (!projects.length) return summary;

  // ------------------------------------------------ the keys SAP matches on --
  // R14 matches a posting to a project by its WBS element, then by the
  // purchase order, then by the cost centre. The register had neither a WBS
  // nor a cost centre on most rows, so the seed gives every project a WBS and
  // every third project a cost centre — enough for all three steps of the
  // matching to be exercised, and obviously synthetic.
  for (const [index, project] of projects.entries()) {
    await db
      .update(schema.project)
      .set({
        sapWbs: `C.${project.code}`,
        costCentre: index % 3 === 0 ? `CC${String(4000 + index)}` : null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.project.id, project.id));
  }

  // -------------------------------------------------------- budget lines --
  // R13: the approved budget by year. A project's total is spread over the
  // years it runs, front-loaded a little, because a capital programme spends
  // more in the middle of a job than at either end.
  for (const project of projects) {
    const total = Number(project.approvedBudget);
    const years = yearsOf(project);
    const category = CATEGORY_BY_PROJECT[project.category] ?? "works";
    const shares = sharesFor(years.length);

    for (const [index, year] of years.entries()) {
      const amount = round2(total * shares[index]);
      await db
        .insert(schema.budgetLine)
        .values({
          orgUnitId: project.orgUnitId,
          projectId: project.id,
          vintageId: VINTAGE,
          lineType: "BUDGET",
          budgetYear: year,
          category,
          amount: String(amount),
        })
        .onConflictDoUpdate({
          target: [
            schema.budgetLine.projectId,
            schema.budgetLine.vintageId,
            schema.budgetLine.budgetYear,
          ],
          // The index is partial — one line per project, vintage and year,
          // and only where there is a project (migration 0005) — so the
          // predicate has to be repeated for Postgres to infer it.
          targetWhere: sql`project_id is not null`,
          set: { amount: String(amount), category, updatedAt: sql`now()` },
        });
      summary.budgetLines += 1;
    }
  }

  const contracts = (await db
    .select({
      id: schema.contract.id,
      projectId: schema.contract.projectId,
      orgUnitId: schema.contract.orgUnitId,
      ref: schema.contract.ref,
      contractNo: schema.contract.contractNo,
      contractorName: schema.contractor.name,
      currentValue: schema.contract.currentValue,
      startDate: schema.contract.startDate,
      awardDate: schema.contract.awardDate,
      sapPoNumber: schema.contract.sapPoNumber,
      retentionPct: schema.contract.retentionPct,
    })
    .from(schema.contract)
    .innerJoin(schema.contractor, eq(schema.contractor.id, schema.contract.contractorId))
    .orderBy(schema.contract.ref)) as SeedContractRow[];

  const projectById = new Map(projects.map((project) => [project.id, project]));

  // --------------------------------------------------------- the batches --
  const committedBatchId = await upsertBatch(db, {
    sha: COMMITTED_BATCH_SHA,
    fileName: "KSB1_2026_02.xlsx",
    report: "KSB1",
    period: "2026-02",
    profileId: "sap_ksb1_v1",
    status: "COMMITTED",
  });
  const pendingBatchId = await upsertBatch(db, {
    sha: PENDING_BATCH_SHA,
    fileName: "ME2N_2026_03.xlsx",
    report: "ME2N",
    period: "2026-03",
    profileId: "sap_me2n_v1",
    status: "PENDING_ALLOCATION",
  });
  summary.importBatches = 2;

  // Both batches are replaced whole on a re-run, so the counts stay right and
  // nothing accumulates.
  for (const batchId of [committedBatchId, pendingBatchId]) {
    await db.delete(schema.costTxn).where(eq(schema.costTxn.importBatchId, batchId));
  }

  // ---------------------------------------------------- the matched month --
  // R13: actual postings against the first twelve contracts, three each, and
  // a commitment against the first six. A project with a SAP commitment reads
  // its committed ledger from the purchase-order balance rather than from the
  // contract, which is the provenance switch CAPEX-01 §7 asks for — and the
  // seed exercises both sides of it.
  const withActuals = contracts.slice(0, 12);
  let document = 4900000;
  for (const [index, contract] of withActuals.entries()) {
    const project = projectById.get(contract.projectId);
    if (!project) continue;
    const value = Number(contract.currentValue);

    for (let month = 0; month < 3; month += 1) {
      document += 1;
      await db.insert(schema.costTxn).values({
        orgUnitId: contract.orgUnitId,
        projectId: contract.projectId,
        contractId: contract.id,
        txnType: "ACTUAL",
        source: "SAP_EXTRACT",
        sourceRef: `${document}#${index * 3 + month + 1}`,
        docDate: `2026-0${month + 1}-10`,
        postingDate: `2026-0${month + 1}-15`,
        amount: String(round2(value * 0.06)),
        description: `Πιστοποίηση εργασιών ${month + 1}/2026 — ${project.titleEl}`,
        vendorName: contract.contractorName,
        sapPo: contract.sapPoNumber,
        costCentre: null,
        glAccount: "0802100",
        importBatchId: committedBatchId,
        matchedBy: "PO",
      });
      summary.costTxns += 1;
    }

    // Deliberately not on the project the two warnings are about: its
    // commitment has to come from the contract ledger for the year-by-year
    // rule to compare like with like.
    if (index < 6 && index !== WARNING_CONTRACT_INDEX) {
      document += 1;
      await db.insert(schema.costTxn).values({
        orgUnitId: contract.orgUnitId,
        projectId: contract.projectId,
        contractId: contract.id,
        txnType: "COMMITMENT",
        source: "SAP_EXTRACT",
        sourceRef: `${contract.sapPoNumber ?? document}/10#${index + 1}`,
        docDate: contract.awardDate,
        postingDate: contract.startDate ?? contract.awardDate,
        amount: String(round2(value * 0.9)),
        description: `Υπόλοιπο εντολής αγοράς — ${project.titleEl}`,
        vendorName: contract.contractorName,
        sapPo: contract.sapPoNumber,
        sapWbs: `C.${project.code}`,
        glAccount: "0802100",
        importBatchId: committedBatchId,
        matchedBy: "WBS",
      });
      summary.costTxns += 1;
    }
  }

  await db.execute(sql`select ecapital.refresh_import_batch_counts(${committedBatchId}::uuid)`);

  // ------------------------------------------------------ remembered rules --
  const users = await db
    .select({ id: schema.appUser.id, subject: schema.appUser.subject })
    .from(schema.appUser);
  const userBySubject = new Map(users.map((user) => [user.subject, user.id]));
  const admin = userBySubject.get("dev-admin") ?? null;
  const estates = userBySubject.get("dev-estates-nicosia") ?? null;

  for (const [index, contract] of contracts.slice(0, 2).entries()) {
    const project = projectById.get(contract.projectId);
    if (!project) continue;
    await db
      .insert(schema.allocationRule)
      .values({
        orgUnitId: contract.orgUnitId,
        projectId: contract.projectId,
        contractId: contract.id,
        vendorName: contract.contractorName,
        vendorNorm: sql`ecapital.normalise(${contract.contractorName})`,
        textNorm: index === 0 ? "" : "συντηρηση ανελκυστηρων",
        hits: 3 + index,
        createdBy: estates,
      })
      .onConflictDoNothing();
    summary.allocationRules += 1;
  }

  // ----------------------------------------------------- the pending month --
  // R14: twelve rows nobody has placed yet, built so the queue has something
  // to suggest — four carry a WBS that belongs to a project, three a purchase
  // order that belongs to a contract, two a cost centre, one a vendor with a
  // remembered rule behind it, and two only a narrative that reads like a
  // project title.
  const unmatched = unmatchedFixtures(projects, contracts);
  for (const [index, row] of unmatched.entries()) {
    await db.insert(schema.costTxn).values({
      orgUnitId: null,
      projectId: null,
      contractId: null,
      txnType: "COMMITMENT",
      source: "SAP_EXTRACT",
      sourceRef: `4510${String(200 + index)}/10#${index + 1}`,
      docDate: "2026-03-05",
      postingDate: "2026-03-31",
      amount: String(row.amount),
      description: row.description,
      vendorName: row.vendorName,
      sapWbs: row.sapWbs,
      sapPo: row.sapPo,
      costCentre: row.costCentre,
      glAccount: "0802200",
      importBatchId: pendingBatchId,
      matchedBy: "NONE",
    });
    summary.unmatchedRows += 1;
    summary.costTxns += 1;
  }
  await db.execute(sql`select ecapital.refresh_import_batch_counts(${pendingBatchId}::uuid)`);

  // ------------------------------------------------- payment certificates --
  // R11: one waiting for the engineer, one waiting for finance, one waiting
  // for payment. The figures are a small fraction of the contract so that the
  // certificate rules have nothing to fire on — the two warnings in this seed
  // are the budget ones, and a third would muddy the fixture.
  if (admin && estates) {
    const certContracts = contracts.slice(12, 15);
    const statuses = ["DRAFT", "ENGINEER_APPROVED", "FINANCE_RECEIVED"] as const;
    for (const [index, contract] of certContracts.entries()) {
      const status = statuses[index];
      const value = Number(contract.currentValue);
      const workDone = round2(value * (0.1 + index * 0.05));
      const materials = round2(value * 0.01);
      const gross = round2(workDone + materials);
      const retention = round2((gross * Number(contract.retentionPct)) / 100);
      const start = contract.startDate ?? contract.awardDate;

      const values = {
        periodFrom: start,
        periodTo: addMonths(start, 1),
        workDoneValue: String(workDone),
        materialsOnSite: String(materials),
        retentionHeld: String(retention),
        previousCertified: "0",
        netPayable: String(round2(gross - retention)),
        status,
        createdBy: estates,
        approvedBy: status === "DRAFT" ? null : admin,
        approvedAt: status === "DRAFT" ? null : sql`now()`,
        sapInvoiceRef: status === "FINANCE_RECEIVED" ? `51000${index}0001` : null,
        paidDate: null,
        retentionReleased: false,
        updatedAt: sql`now()`,
      };

      const existing = await db
        .select({ id: schema.paymentCert.id })
        .from(schema.paymentCert)
        .where(and(eq(schema.paymentCert.contractId, contract.id), eq(schema.paymentCert.number, 1)))
        .limit(1);
      if (existing.length) {
        await db
          .update(schema.paymentCert)
          .set(values)
          .where(eq(schema.paymentCert.id, existing[0].id));
      } else {
        await db.insert(schema.paymentCert).values({
          ...values,
          contractId: contract.id,
          orgUnitId: contract.orgUnitId,
          number: 1,
        });
      }
      summary.paymentCerts += 1;
    }
  }

  // ------------------------------------------------------------ warnings --
  summary.costWarnings = await seedWarnings(db, contracts, projectById);
  return summary;
}

/**
 * Which contract carries the two warnings. Its project's approved budget is
 * pushed down to 70% of what has been committed against it, so both the
 * year rule and the forecast rule hold — and neither the certificate rules
 * nor the variation rule is involved, which keeps the fixture at exactly two.
 */
const WARNING_CONTRACT_INDEX = 0;

async function seedWarnings(
  db: Db,
  contracts: SeedContractRow[],
  projectById: Map<string, SeedProjectRow>,
): Promise<number> {
  const contract = contracts[WARNING_CONTRACT_INDEX];
  if (!contract) return 0;
  const project = projectById.get(contract.projectId);
  if (!project) return 0;

  const committed = Number(contract.currentValue);
  const approved = round2(committed * 0.7);
  const year = Number((contract.startDate ?? contract.awardDate).slice(0, 4));
  const excess = round2(committed - approved);

  // One line, one year, so the year rule and the total rule see the same
  // figures and the two sentences say the same thing about the same money.
  await db
    .delete(schema.budgetLine)
    .where(
      and(eq(schema.budgetLine.projectId, project.id), eq(schema.budgetLine.vintageId, VINTAGE)),
    );
  await db.insert(schema.budgetLine).values({
    orgUnitId: project.orgUnitId,
    projectId: project.id,
    vintageId: VINTAGE,
    lineType: "BUDGET",
    budgetYear: year,
    category: CATEGORY_BY_PROJECT[project.category] ?? "works",
    amount: String(approved),
  });

  const [unit] = await db
    .select({ nameEl: schema.orgUnit.nameEl, nameEn: schema.orgUnit.nameEn })
    .from(schema.orgUnit)
    .where(eq(schema.orgUnit.id, project.orgUnitId))
    .limit(1);

  const i18n = new I18nService("el");
  const money = (value: number, locale: "el" | "en") =>
    new Intl.NumberFormat(locale === "el" ? "el-GR" : "en-GB", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(value);

  const rules = [
    {
      key: "commitmentOverYearBudget" as const,
      params: (locale: "el" | "en") => ({
        project: project.titleEl,
        unit: locale === "el" ? unit.nameEl : unit.nameEn,
        year: String(year),
        committed: money(committed, locale),
        approved: money(approved, locale),
        amount: money(excess, locale),
      }),
    },
    {
      key: "forecastOverApproved" as const,
      params: (locale: "el" | "en") => ({
        project: project.titleEl,
        unit: locale === "el" ? unit.nameEl : unit.nameEn,
        forecast: money(committed, locale),
        approved: money(approved, locale),
        amount: money(excess, locale),
      }),
    },
  ];

  let written = 0;
  for (const rule of rules) {
    const existing = await db
      .select({ id: schema.costWarning.id })
      .from(schema.costWarning)
      .where(
        and(eq(schema.costWarning.projectId, project.id), eq(schema.costWarning.key, rule.key)),
      )
      .limit(1);
    const values = {
      sentenceEl: i18n.translate(`costWarnings.${rule.key}`, "el", rule.params("el")),
      sentenceEn: i18n.translate(`costWarnings.${rule.key}`, "en", rule.params("en")),
      amount: String(excess),
      updatedAt: sql`now()`,
    };
    if (existing.length) {
      await db.update(schema.costWarning).set(values).where(eq(schema.costWarning.id, existing[0].id));
    } else {
      await db.insert(schema.costWarning).values({
        ...values,
        orgUnitId: project.orgUnitId,
        projectId: project.id,
        contractId: null,
        key: rule.key,
      });
    }
    written += 1;
  }
  return written;
}

async function upsertBatch(
  db: Db,
  input: {
    sha: string;
    fileName: string;
    report: "ME2N" | "KSB1" | "FBL1N";
    period: string;
    profileId: string;
    status: "COMMITTED" | "PENDING_ALLOCATION";
  },
): Promise<string> {
  const existing = await db
    .select({ id: schema.importBatch.id })
    .from(schema.importBatch)
    .where(eq(schema.importBatch.fileSha256, input.sha))
    .limit(1);
  if (existing.length) {
    await db
      .update(schema.importBatch)
      .set({ status: input.status, updatedAt: sql`now()` })
      .where(eq(schema.importBatch.id, existing[0].id));
    return existing[0].id;
  }
  const [row] = await db
    .insert(schema.importBatch)
    .values({
      source: "SAP_EXTRACT",
      report: input.report,
      fileName: input.fileName,
      fileSha256: input.sha,
      profileId: input.profileId,
      period: input.period,
      status: input.status,
      importedBy: "seed",
      committed: input.status === "COMMITTED",
    })
    .returning({ id: schema.importBatch.id });
  return row.id;
}

/** The years a project's budget is spread over, from its planned dates. */
function yearsOf(project: SeedProjectRow): number[] {
  const start = Number((project.plannedStart ?? "2026-01-01").slice(0, 4));
  const finish = Number((project.plannedFinish ?? project.plannedStart ?? "2027-01-01").slice(0, 4));
  const years: number[] = [];
  for (let year = start; year <= Math.max(start, finish); year += 1) years.push(year);
  return years.slice(0, 4);
}

/** Front-loaded a little, and always adding to one. */
function sharesFor(count: number): number[] {
  if (count <= 1) return [1];
  const weights = Array.from({ length: count }, (_, index) => (index === 0 ? 2 : 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

interface UnmatchedFixture {
  amount: number;
  description: string;
  vendorName: string | null;
  sapWbs: string | null;
  sapPo: string | null;
  costCentre: string | null;
}

function unmatchedFixtures(
  projects: SeedProjectRow[],
  contracts: SeedContractRow[],
): UnmatchedFixture[] {
  const vendor = (index: number) => contracts[index % Math.max(contracts.length, 1)]?.contractorName ?? null;
  const withCostCentre = projects.filter((_, index) => index % 3 === 0);
  const rows: UnmatchedFixture[] = [];

  // Four carry a sub-element of a project's WBS: the posting names the leaf,
  // the register holds the trunk.
  for (let index = 0; index < 4; index += 1) {
    const project = projects[index * 3] ?? projects[index];
    rows.push({
      amount: 12500 + index * 3750,
      description: `Προμήθεια υλικών — ${project.titleEl.slice(0, 40)}`,
      vendorName: vendor(index),
      sapWbs: `C.${project.code}.${index + 1}`,
      sapPo: null,
      costCentre: null,
    });
  }

  // Three carry a purchase order that belongs to a contract.
  for (let index = 0; index < 3; index += 1) {
    const contract = contracts[index + 4];
    rows.push({
      amount: 8400 + index * 1200,
      description: "Εργασίες ηλεκτρολογικών εγκαταστάσεων",
      vendorName: contract?.contractorName ?? vendor(index),
      sapWbs: null,
      sapPo: contract?.sapPoNumber ?? null,
      costCentre: null,
    });
  }

  // Two carry a cost centre a project carries too.
  for (let index = 0; index < 2; index += 1) {
    const project = withCostCentre[index];
    rows.push({
      amount: 5600 + index * 900,
      description: "Συντήρηση ηλεκτρομηχανολογικού εξοπλισμού",
      vendorName: vendor(index + 2),
      sapWbs: null,
      sapPo: null,
      costCentre: project ? `CC${String(4000 + projects.indexOf(project))}` : null,
    });
  }

  // One is only a vendor with a remembered rule behind it.
  rows.push({
    amount: 4300,
    description: "Συντήρηση ανελκυστήρων, τρίμηνο 1",
    vendorName: contracts[1]?.contractorName ?? null,
    sapWbs: null,
    sapPo: null,
    costCentre: null,
  });

  // Two are only a narrative, and a narrative is a hint and not a fact.
  for (let index = 0; index < 2; index += 1) {
    const project = projects[index + 1];
    rows.push({
      amount: 2750 + index * 640,
      description: project ? project.titleEl : "Διάφορες εργασίες συντήρησης",
      vendorName: vendor(index + 5),
      sapWbs: null,
      sapPo: null,
      costCentre: null,
    });
  }

  return rows;
}
