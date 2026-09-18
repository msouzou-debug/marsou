import type { INestApplication } from "@nestjs/common";
import { AreaTree } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/** R42: full audit log on every mutation, immutable to admin. */
describe("audit log", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("records one row, with the actor and the after-image, for one insert", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const tree = await request(app.getHttpServer())
      .get("/org-units/nicosia-general/areas")
      .set(bearer(token));
    const floorId = AreaTree.parse(tree.body).buildings[0].floors[0].id;

    const code = `AUD-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({
        floorId,
        code,
        nameEl: "Αποθήκη υλικών",
        areaType: "OTHER",
        patientRiskGroup: "LOW",
      });
    expect(created.status).toBe(201);

    const auditorToken = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "area", entity_id: created.body.id })
      .set(bearer(auditorToken));

    expect(log.status).toBe(200);
    expect(log.body).toHaveLength(1);
    const [entry] = log.body;
    expect(entry.action).toBe("INSERT");
    expect(entry.actorId).toBe("dev-estates-nicosia");
    expect(entry.orgUnitId).toBe("nicosia-general");
    expect(entry.before).toBeNull();
    expect(entry.after).toMatchObject({ code, area_type: "OTHER", patient_risk_group: "LOW" });
    expect(new Date(entry.at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("writes nothing when the mutation is refused", async () => {
    const estatesToken = await tokenFor(app, USERS.estatesNicosia);
    const tree = await request(app.getHttpServer())
      .get("/org-units/nicosia-general/areas")
      .set(bearer(estatesToken));
    const floorId = AreaTree.parse(tree.body).buildings[0].floors[0].id;

    const code = `REF-${Date.now()}`;
    const auditorToken = await tokenFor(app, USERS.auditor);
    const refused = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(auditorToken))
      .send({ floorId, code, nameEl: "Δοκιμή", areaType: "OFFICE", patientRiskGroup: "LOW" });
    expect(refused.status).toBe(403);

    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "area" })
      .set(bearer(auditorToken));
    expect(
      log.body.filter((e: { after: { code?: string } | null }) => e.after?.code === code),
    ).toHaveLength(0);
  });

  it("is closed to everyone who is not an auditor or an administrator", async () => {
    for (const email of [USERS.estatesNicosia, USERS.engineerLarnaca, USERS.clinicalNicosia]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer()).get("/audit-log").set(bearer(token));
      expect(response.status).toBe(403);
      expect(response.body.key).toBe("errors.notAllowed");
    }
  });

  it("is open to the administrator", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/audit-log").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it("refuses a query it cannot read", async () => {
    const token = await tokenFor(app, USERS.auditor);
    const response = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ limit: "9000" })
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.auditQueryNotValid");
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/audit-log");
    expect(response.status).toBe(401);
  });
});

/**
 * R42 again, at the level that matters: even with a direct connection, the
 * log cannot be edited. The application role has no grant, and the trigger
 * stops the owner and a superuser too — which is what "immutable to admin"
 * has to mean if it is to mean anything.
 */
describe("audit log immutability", () => {
  it("refuses UPDATE and DELETE to the application role", async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query("update ecapital.audit_log set actor_id = 'someone else'"),
      ).rejects.toThrow(/permission denied/i);
      await expect(client.query("delete from ecapital.audit_log")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await client.end();
    }
  });

  it("refuses UPDATE and DELETE to the owner of the table as well", async () => {
    const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await client.connect();
    try {
      await expect(
        client.query("update ecapital.audit_log set actor_id = 'someone else' where id = 1"),
      ).rejects.toThrow(/append-only/);
      await expect(client.query("delete from ecapital.audit_log where id = 1")).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await client.end();
    }
  });
});
