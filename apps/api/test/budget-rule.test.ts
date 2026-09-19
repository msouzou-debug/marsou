import type { INestApplication } from "@nestjs/common";
import { ProjectDetail } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { projectAt } from "./contract-support";

/**
 * ADR-0014, the owner's decision of 19/09/2026: once a project is APPROVED or
 * later, only finance changes its approved budget. Before that it is an
 * ordinary field. An administrator is not exempt — the segregation is the
 * point of the rule, and the ADR says to widen it here if operations need it.
 */
describe("who may change the approved budget", () => {
  let app: INestApplication;
  let client: Client;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  it("lets anyone who may edit change it before the project is approved", async () => {
    const project = await projectAt(
      app,
      "PREPARATION",
      `Προϋπολογισμός πριν την έγκριση ${Date.now()}`,
      USERS.estatesNicosia,
    );
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .patch(`/projects/${project.id}`)
      .set(bearer(token))
      .send({ approvedBudget: 1_250_000 });
    expect(response.status).toBe(200);
    expect(ProjectDetail.parse(response.body).approvedBudget).toBe(1_250_000);
  });

  it("refuses the head of estates and the administrator once it is approved", async () => {
    const project = await projectAt(
      app,
      "APPROVED",
      `Προϋπολογισμός μετά την έγκριση ${Date.now()}`,
      USERS.estatesNicosia,
    );

    for (const email of [USERS.estatesNicosia, USERS.admin]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .patch(`/projects/${project.id}`)
        .set(bearer(token))
        .send({ approvedBudget: 2_000_000 });
      expect(response.status).toBe(403);
      expect(response.body.key).toBe("errors.budgetFinanceOnly");
    }

    // The figure did not move.
    const token = await tokenFor(app, USERS.admin);
    const after = await request(app.getHttpServer())
      .get(`/projects/${project.id}`)
      .set(bearer(token));
    expect(ProjectDetail.parse(after.body).approvedBudget).toBe(1_000_000);
  });

  it("lets finance change it, and records who did and what it was", async () => {
    const project = await projectAt(
      app,
      "IN_PROGRESS",
      `Προϋπολογισμός από Οικονομική ${Date.now()}`,
      USERS.estatesNicosia,
    );
    const token = await tokenFor(app, USERS.finance);
    const response = await request(app.getHttpServer())
      .patch(`/projects/${project.id}`)
      .set(bearer(token))
      .send({ approvedBudget: 1_400_000 });
    expect(response.status).toBe(200);
    expect(ProjectDetail.parse(response.body).approvedBudget).toBe(1_400_000);

    // R42: the audit trigger wrote it with the actor and both images.
    const { rows } = await client.query<{
      actor_id: string;
      before: { approved_budget: string };
      after: { approved_budget: string };
    }>(
      `select actor_id, before, after from ecapital.audit_log
        where entity_type = 'project' and entity_id = $1 and action = 'UPDATE'
        order by id desc limit 1`,
      [project.id],
    );
    expect(rows[0].actor_id).toBe("dev-finance");
    expect(Number(rows[0].before.approved_budget)).toBe(1_000_000);
    expect(Number(rows[0].after.approved_budget)).toBe(1_400_000);
  });

  it("gives finance the budget and nothing else on the project", async () => {
    // The register's write policy still belongs to admin, the head of estates
    // and the engineers; ecapital.set_approved_budget is a door for one field.
    const project = await projectAt(
      app,
      "IN_PROGRESS",
      `Τίτλος από Οικονομική ${Date.now()}`,
      USERS.estatesNicosia,
    );
    const token = await tokenFor(app, USERS.finance);
    const response = await request(app.getHttpServer())
      .patch(`/projects/${project.id}`)
      .set(bearer(token))
      .send({ titleEl: "Νέος τίτλος από την Οικονομική Διεύθυνση" });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.readOnlyAccount");
  });

  it("lets a patch that repeats the same budget through, because it changes nothing", async () => {
    const project = await projectAt(
      app,
      "APPROVED",
      `Ίδιος προϋπολογισμός ${Date.now()}`,
      USERS.estatesNicosia,
    );
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .patch(`/projects/${project.id}`)
      .set(bearer(token))
      .send({ approvedBudget: 1_000_000, titleEl: "Ίδιος προϋπολογισμός, νέος τίτλος" });
    expect(response.status).toBe(200);
    expect(ProjectDetail.parse(response.body).titleEl).toBe("Ίδιος προϋπολογισμός, νέος τίτλος");
  });

  it("refuses a direct call to the function from anybody who is not finance", async () => {
    // The role check lives in the function itself, so a future endpoint that
    // forgets it still cannot move the figure (ADR-0015).
    const project = await projectAt(
      app,
      "APPROVED",
      `Απευθείας κλήση ${Date.now()}`,
      USERS.estatesNicosia,
    );
    await client.query("begin");
    try {
      await client.query("select set_config('app.user_id', 'dev-estates-nicosia', true)");
      await client.query("select set_config('app.roles', 'estates_head', true)");
      await client.query("select set_config('app.org_unit_ids', 'nicosia-general', true)");
      const { rows } = await client.query<{ done: boolean }>(
        "select ecapital.set_approved_budget($1::uuid, 5000000::numeric) as done",
        [project.id],
      );
      expect(rows[0].done).toBe(false);
    } finally {
      await client.query("rollback");
    }

    const token = await tokenFor(app, USERS.admin);
    const after = await request(app.getHttpServer())
      .get(`/projects/${project.id}`)
      .set(bearer(token));
    expect(ProjectDetail.parse(after.body).approvedBudget).toBe(1_000_000);
  });
});
