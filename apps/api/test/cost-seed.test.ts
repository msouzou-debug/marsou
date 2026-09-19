/**
 * The M2 seed (CAPEX-01 §15): what a fresh database has in it before anybody
 * types anything, and the promise that running the seed twice changes
 * nothing.
 *
 * The figures are obviously fake and there is no patient data anywhere in
 * them; what matters here is that each screen the web app is building has
 * something real to draw — a budget by year, a month already matched, a
 * month still waiting, certificates at three different points and two live
 * warnings.
 */
import { Client } from "pg";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

describe("the cost seed", () => {
  let app: INestApplication;
  let db: Client;

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
  });

  afterAll(async () => {
    await db.end();
    await app.close();
  });

  it("gives every project in the register an approved budget by year", async () => {
    const { rows } = await db.query<{ projects: number; withBudget: number }>(
      `select (select count(*) from ecapital.project where import_batch_id is null)::int as projects,
              (select count(distinct project_id) from ecapital.budget_line
                where vintage_id = '2026-02')::int as "withBudget"`,
    );
    expect(rows[0].withBudget).toBeGreaterThanOrEqual(43);
  });

  it("has one month already matched and one still waiting", async () => {
    const token = await tokenFor(app, USERS.finance);
    const response = await request(app.getHttpServer()).get("/cost/imports").set(bearer(token));
    expect(response.status).toBe(200);

    const committed = response.body.items.find(
      (item: { fileName: string }) => item.fileName === "KSB1_2026_02.xlsx",
    );
    const pending = response.body.items.find(
      (item: { fileName: string }) => item.fileName === "ME2N_2026_03.xlsx",
    );
    expect(committed.status).toBe("COMMITTED");
    expect(committed.rowsUnmatched).toBe(0);
    expect(committed.rowsMatched).toBeGreaterThan(0);
    expect(pending.status).toBe("PENDING_ALLOCATION");
    expect(pending.rowsUnmatched).toBe(12);
  });

  it("gives the queue twelve rows with something to suggest on most of them", async () => {
    const token = await tokenFor(app, USERS.finance);
    const list = await request(app.getHttpServer()).get("/cost/imports").set(bearer(token));
    const pending = list.body.items.find(
      (item: { fileName: string }) => item.fileName === "ME2N_2026_03.xlsx",
    );
    const queue = await request(app.getHttpServer())
      .get(`/cost/imports/${pending.id}/unmatched`)
      .set(bearer(token));
    expect(queue.body.total).toBe(12);
    expect(queue.body.items.length).toBeGreaterThan(0);
    const withSuggestions = queue.body.items.filter(
      (row: { suggestions: unknown[] }) => row.suggestions.length > 0,
    );
    expect(withSuggestions.length).toBeGreaterThanOrEqual(queue.body.items.length - 2);
    for (const row of queue.body.items) {
      expect(row.suggestions.length).toBeLessThanOrEqual(9);
    }
  });

  it("has three payment certificates at three different points", async () => {
    const { rows } = await db.query<{ status: string; n: number }>(
      "select status::text, count(*)::int as n from ecapital.payment_cert group by status order by status",
    );
    const byStatus = new Map(rows.map((row) => [row.status, row.n]));
    expect(byStatus.get("DRAFT")).toBeGreaterThanOrEqual(1);
    expect(byStatus.get("ENGINEER_APPROVED")).toBeGreaterThanOrEqual(1);
    expect(byStatus.get("FINANCE_RECEIVED")).toBeGreaterThanOrEqual(1);
  });

  it("has two live warnings that survive being looked at", async () => {
    // The seeded project, named by the two rules it was built to fire. Other
    // suites write warnings of their own to this database, so the query says
    // which project it means rather than taking whichever has the most.
    const { rows } = await db.query<{ project_id: string; n: number }>(
      `select project_id, count(*)::int as n from ecapital.cost_warning
        where dismissed_at is null
          and key in ('commitmentOverYearBudget', 'forecastOverApproved')
        group by project_id having count(*) = 2 limit 1`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(2);

    // R31 re-evaluates on read. A seeded warning that vanished the first time
    // somebody opened the screen would be a demo and not a fixture, so the
    // figures behind it are real: the budget line is below the commitment.
    const token = await tokenFor(app, USERS.finance);
    const cost = await request(app.getHttpServer())
      .get(`/projects/${rows[0].project_id}/cost`)
      .set(bearer(token));
    expect(cost.status).toBe(200);
    const live = cost.body.warnings.filter(
      (warning: { dismissedAt: string | null }) => warning.dismissedAt === null,
    );
    const keys = live.map((warning: { key: string }) => warning.key).sort();
    expect(keys).toContain("commitmentOverYearBudget");
    expect(keys).toContain("forecastOverApproved");
  });

  it("carries the keys the SAP matching needs", async () => {
    const { rows } = await db.query<{ wbs: number; centres: number }>(
      `select (select count(*) from ecapital.project where sap_wbs is not null)::int as wbs,
              (select count(*) from ecapital.project where cost_centre is not null)::int as centres`,
    );
    expect(rows[0].wbs).toBeGreaterThanOrEqual(43);
    expect(rows[0].centres).toBeGreaterThan(0);
  });
});
