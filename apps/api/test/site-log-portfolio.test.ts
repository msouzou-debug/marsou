import type { INestApplication } from "@nestjs/common";
import { PortfolioResponse } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R09, R12 on S01 — the two things the site log contributes to «Χρειάζονται
 * προσοχή»: a handover defect that has outlived the defects liability period
 * (red) and an RFI whose SLA ran out with nobody answering it (amber).
 *
 * Both are warn-and-flag (CAPEX-01 §1): the portfolio says so and nothing
 * stops. Both compete with everything else for the same eight places, so the
 * assertions below look at the caller whose unit the seed put them in.
 */
describe("the site log on the portfolio", () => {
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

  it("calls out a handover defect that has outlived its liability period, in red", async () => {
    const view = await portfolio(USERS.admin);
    const overdue = view.exceptions.filter((e) => e.id.startsWith("EXC-DF-"));
    expect(overdue.length).toBeGreaterThan(0);
    for (const exception of overdue) {
      expect(exception.severity).toBe("red");
      expect(exception.href).toMatch(/^\/defects\/[0-9a-f-]{36}$/);
      expect(exception.sentenceEl).not.toBe(exception.sentenceEn);
      expect(exception.sentenceEl).toContain("έλλειψη");
    }
  });

  it("calls out a breached RFI in amber, on the contract that owes the answer", async () => {
    // The seed puts the one breached RFI on a Larnaca contract, so read the
    // portfolio as the engineer who would have to answer it.
    const view = await portfolio(USERS.engineerLarnaca);
    const breached = view.exceptions.filter((e) => e.id.startsWith("EXC-RFI-"));
    expect(breached.length).toBeGreaterThan(0);
    for (const exception of breached) {
      expect(exception.severity).toBe("amber");
      expect(exception.href).toMatch(/^\/contracts\/[0-9a-f-]{36}$/);
      expect(exception.orgUnitId).toBe("larnaca-general");
      expect(exception.sentenceEn).toContain("RFI");
    }
  });

  it("keeps the whole list inside the cap of eight, red first", async () => {
    const view = await portfolio(USERS.admin);
    expect(view.exceptions.length).toBeLessThanOrEqual(8);
    const severities = view.exceptions.map((e) => e.severity);
    const firstAmber = severities.indexOf("amber");
    if (firstAmber >= 0) expect(severities.slice(firstAmber)).not.toContain("red");
  });

  it("shows nobody a unit they may not read", async () => {
    const view = await portfolio(USERS.engineerLarnaca);
    for (const exception of view.exceptions) {
      expect(exception.orgUnitId).toBe("larnaca-general");
    }
  });
});
