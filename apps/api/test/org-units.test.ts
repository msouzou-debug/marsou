import type { INestApplication } from "@nestjs/common";
import { OrgUnit } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * R01 and the M0 definition of done: a user sees their own units and nothing
 * else. The response shape is the one the frontend mock already served
 * (ADR-0005), so the app swaps base URL and notices nothing.
 */
describe("GET /org-units", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("gives a central administration user all eleven units", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(11);
    expect(() => OrgUnit.array().parse(response.body)).not.toThrow();
  });

  it("gives the head of estates at Nicosia only Nicosia", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.map((u: OrgUnit) => u.id)).toEqual(["nicosia-general"]);
  });

  it("gives the auditor every unit, read-only", async () => {
    const token = await tokenFor(app, USERS.auditor);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(11);
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/org-units");
    expect(response.status).toBe(401);
  });

  it("serves exactly the fields the frontend mock served", async () => {
    // ADR-0005: the app swaps base URL and the shape does not move under it.
    // An extra field here — an alias, an internal timestamp — is a bug.
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const nicosia = response.body.find((u: OrgUnit) => u.id === "nicosia-general");
    expect(Object.keys(nicosia).sort()).toEqual([
      "code",
      "costCentre",
      "directorate",
      "entityCode",
      "id",
      "nameEl",
      "nameEn",
      "timezone",
      "type",
    ]);
    expect(nicosia).toEqual({
      id: "nicosia-general",
      code: "NGH",
      nameEl: "Γενικό Νοσοκομείο Λευκωσίας",
      nameEn: "Nicosia General Hospital",
      type: "HOSPITAL",
      directorate: "LEFKOSIAS",
      costCentre: "CC-NGH-01",
      // ADR-0019: the eFinance entity code, sent as a code and never a name.
      entityCode: "NGH",
      timezone: "Europe/Nicosia",
    });
  });

  it("carries Troodos with Kyperounta as one hospital", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const ids = response.body.map((u: OrgUnit) => u.id);
    expect(ids).toContain("troodos");
    expect(ids).not.toContain("kyperounta");
  });

  it("carries HQ, added by owner decision on 19/09/2026", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/org-units").set(bearer(token));
    const ids = response.body.map((u: OrgUnit) => u.id);
    expect(ids).toContain("hq");
  });

  it("re-seeds the same eleven org units on a second run, never a duplicate", async () => {
    const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    try {
      await seed(process.env.MIGRATION_DATABASE_URL as string);
      const { rows } = await client.query<{ n: string }>(
        "select count(*) as n from ecapital.org_unit",
      );
      expect(Number(rows[0].n)).toBe(11);
      const { rows: hq } = await client.query<{ n: string }>(
        "select count(*) as n from ecapital.org_unit where id = 'hq'",
      );
      expect(Number(hq[0].n)).toBe(1);
    } finally {
      await client.end();
    }
  });
});
