import type { INestApplication } from "@nestjs/common";
import type { ContractDetail, ContractorCreate, ProjectDetail } from "@ecapital/shared";
import request from "supertest";
import { USERS, bearer, tokenFor } from "./app";

/**
 * Fixtures the contract suites build for themselves rather than borrow from
 * the seed: a project walked up to a phase, a contractor, a contract. The
 * seed is a demo register and other suites write to it; a test that needs a
 * variation in a known state builds its own so it cannot be surprised.
 */

const PHASES = [
  "IDEA",
  "PREPARATION",
  "APPROVED",
  "TENDERED",
  "AWARDED",
  "IN_PROGRESS",
  "PRACTICAL_COMPLETION",
  "DEFECTS_LIABILITY",
  "CLOSED",
] as const;

export type Phase = (typeof PHASES)[number];

export function projectBody(titleEl: string, orgUnitId = "nicosia-general") {
  return {
    orgUnitId,
    titleEl,
    titleEn: null,
    category: "RENOVATION" as const,
    approvedBudget: 1_000_000,
    fundingSource: "STATE_BUDGET" as const,
    plannedStart: "2027-01-11",
    plannedFinish: "2027-11-30",
    budgetYearFrom: 2027,
    budgetYearTo: 2027,
    sapWbs: null,
    tenderReference: null,
    sponsorId: null,
    projectManagerId: null,
  };
}

/**
 * A project at the phase asked for. The phases move one step at a time with a
 * reason, the way R04 says they do; a fresh project has no gate milestone, so
 * nothing is in the way.
 */
export async function projectAt(
  app: INestApplication,
  phase: Phase,
  titleEl: string,
  email: string = USERS.admin,
  orgUnitId = "nicosia-general",
): Promise<ProjectDetail> {
  const token = await tokenFor(app, email);
  const created = await request(app.getHttpServer())
    .post("/projects")
    .set(bearer(token))
    .send(projectBody(titleEl, orgUnitId));
  if (created.status !== 201) throw new Error(`could not open the project: ${created.status}`);
  const id = created.body.id as string;

  for (const step of PHASES.slice(1, PHASES.indexOf(phase) + 1)) {
    const moved = await request(app.getHttpServer())
      .post(`/projects/${id}/phase`)
      .set(bearer(token))
      .send({ phase: step, reasonEl: "Δοκιμαστική μετάβαση σταδίου" });
    if (moved.status !== 200) throw new Error(`could not move to ${step}: ${moved.status}`);
  }

  const detail = await request(app.getHttpServer())
    .get(`/projects/${id}`)
    .set(bearer(token));
  return detail.body as ProjectDetail;
}

export async function makeContractor(
  app: INestApplication,
  name: string,
  email: string = USERS.admin,
): Promise<{ id: string; name: string }> {
  const token = await tokenFor(app, email);
  const body: ContractorCreate = {
    name,
    vatNumber: "CY10399999Z",
    registrationNo: "HE 199999",
    category: "BUILDING",
    sapVendorId: null,
  };
  const created = await request(app.getHttpServer())
    .post("/contractors")
    .set(bearer(token))
    .send(body);
  if (created.status !== 201) throw new Error(`could not add the contractor: ${created.status}`);
  return { id: created.body.id as string, name };
}

export function contractBody(
  projectId: string,
  contractorId: string,
  contractNo: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    projectId,
    contractorId,
    contractNo,
    type: "LUMP_SUM" as const,
    awardDate: "2026-09-01",
    originalValue: 500_000,
    startDate: "2026-09-15",
    completionDate: "2027-09-15",
    retentionPct: 5,
    performanceBondValue: 50_000,
    bondExpiry: "2027-12-15",
    liquidatedDamagesPerDay: 250,
    defectsLiabilityMonths: 12,
    sapPoNumber: "4500900001",
    // ADR-0025: one of the seeded CAPEX codes, so the ordinary fixture path
    // exercises a contract that has one rather than every test having to opt
    // in. `budget-codes.test.ts` covers null, an unknown code and a change.
    budgetCode: "7402",
    ...overrides,
  };
}

/** A project at AWARDED, a contractor and a contract on it, in one call. */
export async function makeContract(
  app: INestApplication,
  stamp: string,
  overrides: Record<string, unknown> = {},
  email: string = USERS.admin,
  orgUnitId = "nicosia-general",
): Promise<{ contract: ContractDetail; project: ProjectDetail; contractorId: string }> {
  const project = await projectAt(
    app,
    "IN_PROGRESS",
    `Σύμβαση δοκιμής ${stamp}`,
    email,
    orgUnitId,
  );
  const contractor = await makeContractor(app, `Ανάδοχος δοκιμής ${stamp}`);
  const token = await tokenFor(app, email);
  const created = await request(app.getHttpServer())
    .post(`/projects/${project.id}/contracts`)
    .set(bearer(token))
    .send(contractBody(project.id, contractor.id, `ΤΥ/ΔΟΚ/${stamp}`, overrides));
  if (created.status !== 201) {
    throw new Error(`could not record the contract: ${created.status} ${JSON.stringify(created.body)}`);
  }
  return { contract: created.body as ContractDetail, project, contractorId: contractor.id };
}
