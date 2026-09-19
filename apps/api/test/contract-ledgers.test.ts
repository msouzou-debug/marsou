import type { INestApplication } from "@nestjs/common";
import {
  ContractDetail,
  ContractList,
  PortfolioResponse,
  ProjectDetail,
  ProjectList,
} from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R13 — the commitment ledger, now that there is something to put in it. The
 * commitment of a project is the sum of the current value of its contracts,
 * and it is null, never zero, before the first one is awarded (CAPEX-01 §7).
 *
 * R31 — the same three warnings on the contract page and in the portfolio's
 * exceptions list, computed over the seeded register.
 */
describe("the commitment ledger", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function projects(email: string): Promise<ProjectList> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get("/projects?pageSize=200")
      .set(bearer(token));
    expect(response.status).toBe(200);
    return ProjectList.parse(response.body);
  }

  async function contractsOf(email: string, projectId: string): Promise<ContractList> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get(`/projects/${projectId}/contracts`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    return ContractList.parse(response.body);
  }

  it("adds up the current value of the project's own contracts", async () => {
    const list = await projects(USERS.admin);
    const seeded = list.items.filter((p) => p.sourceRowRef !== null);
    const awarded = seeded.filter((p) => p.ledgers.committed !== null);
    // Seventeen since ADR-0024: PRJ-037 was the Ambulance Service's and
    // took its contract with it.
    expect(awarded.length).toBeGreaterThanOrEqual(17);

    for (const project of awarded.slice(0, 5)) {
      const contracts = await contractsOf(USERS.admin, project.id);
      const expected = contracts.items.reduce((sum, c) => sum + c.currentValue, 0);
      expect(project.ledgers.committed).toBeCloseTo(expected, 2);
    }
  });

  it("says null, not zero, for a project with no contract", async () => {
    const list = await projects(USERS.admin);
    const early = list.items.filter((p) => p.sourceRowRef !== null && p.phase === "PREPARATION");
    expect(early.length).toBeGreaterThan(0);
    expect(early.every((p) => p.ledgers.committed === null)).toBe(true);
  });

  it("gives the project page the same figure as the list", async () => {
    const list = await projects(USERS.admin);
    const project = list.items.find((p) => p.ledgers.committed !== null);
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/projects/${project?.id}`)
      .set(bearer(token));
    const detail = ProjectDetail.parse(response.body);
    expect(detail.ledgers.committed).toBeCloseTo(project?.ledgers.committed ?? 0, 2);
    // The two the system still does not know stay null (CAPEX-01 §7).
    expect(detail.ledgers.spent).toBeNull();
    expect(detail.ledgers.forecast).toBeNull();
  });

  it("matches the portfolio KPI and the unit rows to the projects behind them", async () => {
    for (const email of [USERS.admin, USERS.engineerLarnaca]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer()).get("/portfolio").set(bearer(token));
      const view = PortfolioResponse.parse(response.body);
      const list = await projects(email);

      const withContract = list.items.filter((p) => p.ledgers.committed !== null);
      const expected = withContract.reduce((sum, p) => sum + (p.ledgers.committed ?? 0), 0);
      expect(view.kpis.committed).toBeCloseTo(expected, 2);

      for (const row of view.units) {
        const mine = withContract.filter((p) => p.orgUnitId === row.orgUnit.id);
        if (!mine.length) {
          expect(row.committed ?? null).toBeNull();
        } else {
          expect(row.committed).toBeCloseTo(
            mine.reduce((sum, p) => sum + (p.ledgers.committed ?? 0), 0),
            2,
          );
        }
      }
    }
  });
});

describe("the seeded warnings (R31)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** The contract the seed put on the project with this source reference. */
  async function seededContract(email: string, sourceRowRef: string): Promise<ContractDetail> {
    const token = await tokenFor(app, email);
    const list = await request(app.getHttpServer())
      .get("/projects?pageSize=200")
      .set(bearer(token));
    const project = ProjectList.parse(list.body).items.find(
      (p) => p.sourceRowRef === sourceRowRef,
    );
    if (!project) throw new Error(`no seeded project ${sourceRowRef}`);
    const contracts = await request(app.getHttpServer())
      .get(`/projects/${project.id}/contracts`)
      .set(bearer(token));
    const first = ContractList.parse(contracts.body).items[0];
    const detail = await request(app.getHttpServer())
      .get(`/contracts/${first.id}`)
      .set(bearer(token));
    expect(detail.status).toBe(200);
    return ContractDetail.parse(detail.body);
  }

  it("flags the contract whose approved variations passed a tenth of its value", async () => {
    const contract = await seededContract(USERS.admin, "PRJ-031");
    // The seed approves 6 + 5 + 3 per cent of the original value.
    expect(contract.variationPctOfOriginal).toBeCloseTo(14, 1);
    expect(contract.currentValue).toBeGreaterThan(contract.originalValue);
    const warning = contract.warnings.find((w) => w.key === "variationsOverTenPct");
    expect(warning).toBeDefined();
    expect(warning?.amount).toBeGreaterThan(0);
    expect(warning?.sentenceEl).toContain("Γενικό Νοσοκομείο Λάρνακας");
    expect(warning?.sentenceEn).toContain("Larnaca General Hospital");
  });

  it("carries one variation waiting for a decision, one returned and one rejected", async () => {
    const withReturn = await seededContract(USERS.admin, "PRJ-031");
    const statuses = withReturn.variations.map((v) => v.status);
    expect(statuses).toContain("SUBMITTED");
    expect(statuses).toContain("RETURNED");
    expect(withReturn.pendingVariationsTotal).toBeGreaterThan(0);
    const returned = withReturn.variations.find((v) => v.status === "RETURNED");
    expect(returned?.decisionCommentEl).not.toBeNull();
    // R10: the seed's approver is never the seed's raiser.
    for (const variation of withReturn.variations) {
      if (variation.decidedById) expect(variation.decidedById).not.toBe(variation.raisedById);
    }

    const withReject = await seededContract(USERS.admin, "PRJ-036");
    expect(withReject.variations.map((v) => v.status)).toContain("REJECTED");
    expect(withReject.variations.map((v) => v.status)).toContain("SUBMITTED");
  });

  it("flags the contract whose performance bond was allowed to lapse", async () => {
    const contract = await seededContract(USERS.admin, "PRJ-036");
    expect(contract.bondExpiry).toBe("2026-06-30");
    const warning = contract.warnings.find((w) => w.key === "bondExpired");
    expect(warning).toBeDefined();
    expect(warning?.amount).toBeNull();
    expect(warning?.sentenceEl).toContain("30/06/2026");
  });

  it("carries a bill of quantities on three of the seeded contracts", async () => {
    const priced = await seededContract(USERS.admin, "PRJ-031");
    expect(priced.boq.length).toBe(6);
    // Every amount is qty × rate, worked out by the database.
    for (const line of priced.boq) {
      expect(line.amount).toBeCloseTo(line.qty * line.rate, 2);
    }
  });

  it("puts the same warnings in the portfolio as amber exceptions on the contract", async () => {
    // The Larnaca engineer's list is short enough that the cap of eight does
    // not hide them, which is the point of looking there and not at the board's.
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer()).get("/portfolio").set(bearer(token));
    const view = PortfolioResponse.parse(response.body);
    expect(view.exceptions.length).toBeLessThanOrEqual(8);

    const fromContracts = view.exceptions.filter((e) => e.href.startsWith("/contracts/"));
    expect(fromContracts.length).toBeGreaterThan(0);
    for (const exception of fromContracts) {
      // RULE (R31): warn and flag. Amber, never red, and nothing is blocked.
      expect(exception.severity).toBe("amber");
      expect(exception.orgUnitId).toBe("larnaca-general");
      expect(exception.sentenceEl).toContain("Γενικό Νοσοκομείο Λάρνακας");
      expect(exception.sentenceEn).toContain("Larnaca General Hospital");
    }
  });
});
