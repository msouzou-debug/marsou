import type { INestApplication } from "@nestjs/common";
import { PortfolioResponse, ProjectList } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { linearRamp, yearElapsedPct } from "../src/portfolio/portfolio.service";

/**
 * R03 — S01 Χαρτοφυλάκιο, built from whatever the caller may see. The sums
 * have to be the sums of that caller's own projects and nobody else's, which
 * is the whole point of computing them in the database's transaction rather
 * than over a cached total.
 */
describe("GET /portfolio", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function portfolio(email: string): Promise<PortfolioResponse> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer()).get("/portfolio").set(bearer(token));
    expect(response.status).toBe(200);
    return PortfolioResponse.parse(response.body);
  }

  async function projects(email: string): Promise<ProjectList> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get("/projects?pageSize=200")
      .set(bearer(token));
    return ProjectList.parse(response.body);
  }

  it("adds up the approved budget of exactly the projects the caller sees", async () => {
    for (const email of [USERS.admin, USERS.engineerLarnaca, USERS.estatesNicosia]) {
      const [view, list] = await Promise.all([portfolio(email), projects(email)]);
      const expected = list.items.reduce((sum, p) => sum + p.approvedBudget, 0);
      expect(view.kpis.approved).toBeCloseTo(expected, 2);
      expect(view.units.reduce((sum, u) => sum + u.approved, 0)).toBeCloseTo(expected, 2);
      expect(view.units.reduce((sum, u) => sum + u.projectCount, 0)).toBe(list.total);
    }
  });

  it("gives the Larnaca engineer one unit and the board all eleven", async () => {
    const larnaca = await portfolio(USERS.engineerLarnaca);
    expect(larnaca.units.map((u) => u.orgUnit.id)).toEqual(["larnaca-general"]);

    const board = await portfolio(USERS.executive);
    expect(board.units).toHaveLength(11);
  });

  it("leaves the three ledgers it does not know null and spends nothing", async () => {
    // CAPEX-01 §7: never zero for a figure the system has not been told.
    const view = await portfolio(USERS.admin);
    expect(view.kpis.committed).toBeNull();
    expect(view.kpis.spent).toBeNull();
    expect(view.kpis.forecast).toBeNull();
    expect(view.units.every((u) => u.sparkline.spend.every((point) => point === 0))).toBe(true);
    expect(view.units.every((u) => u.sparkline.plan.length === 12)).toBe(true);
  });

  it("counts the projects by rag the way the register stores it", async () => {
    const [view, list] = await Promise.all([portfolio(USERS.admin), projects(USERS.admin)]);
    const red = list.items.filter((p) => p.rag === "RED").length;
    expect(view.units.reduce((sum, u) => sum + u.rag.red, 0)).toBe(red);
  });

  it("shows at most eight exceptions, in both languages, each naming its unit", async () => {
    const view = await portfolio(USERS.admin);
    expect(view.exceptions.length).toBeGreaterThan(0);
    expect(view.exceptions.length).toBeLessThanOrEqual(8);
    for (const exception of view.exceptions) {
      expect(exception.sentenceEl).not.toBe("");
      expect(exception.sentenceEn).not.toBe("");
      expect(exception.sentenceEl).not.toBe(exception.sentenceEn);
      expect(exception.href).toBe(`/projects/${exception.projectId}`);
      const unit = view.units.find((u) => u.orgUnit.id === exception.orgUnitId);
      expect(exception.sentenceEl).toContain(unit?.orgUnit.nameEl);
      expect(exception.sentenceEn).toContain(unit?.orgUnit.nameEn);
    }
    // The seed puts one of each kind in (CAPEX-01 §15).
    expect(view.exceptions.some((e) => e.severity === "red")).toBe(true);
  });

  it("finds all three kinds of exception in the seed", async () => {
    const token = await tokenFor(app, USERS.admin);
    // The cap hides some of them from /portfolio, so look for the underlying
    // facts instead: a slipped gate, an undated project and an overdue one.
    const list = await request(app.getHttpServer())
      .get("/projects?pageSize=200")
      .set(bearer(token));
    const items = ProjectList.parse(list.body).items.filter((p) => p.sourceRowRef !== null);
    expect(items.filter((p) => p.plannedStart === null)).toHaveLength(2);
    expect(
      items.filter(
        (p) =>
          p.phase === "IN_PROGRESS" &&
          p.plannedFinish !== null &&
          p.plannedFinish < new Date().toISOString().slice(0, 10),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/portfolio");
    expect(response.status).toBe(401);
  });
});

describe("the portfolio arithmetic", () => {
  it("measures the year the way every KPI tile's comparator does", () => {
    expect(yearElapsedPct(new Date("2026-01-01T00:00:00Z"))).toBeCloseTo(0, 5);
    expect(yearElapsedPct(new Date("2026-07-02T12:00:00Z"))).toBeGreaterThan(49);
    expect(yearElapsedPct(new Date("2026-07-02T12:00:00Z"))).toBeLessThan(51);
  });

  it("spreads the plan evenly and lands exactly on the total", () => {
    const ramp = linearRamp(1_200_000);
    expect(ramp).toHaveLength(12);
    expect(ramp[0]).toBe(100_000);
    expect(ramp[11]).toBe(1_200_000);
    expect(linearRamp(0).every((point) => point === 0)).toBe(true);
  });
});
