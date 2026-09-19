import type { INestApplication } from "@nestjs/common";
import { ApproverScopes } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { nicosiaAreas, type AreaIds } from "./permit-support";

/**
 * M3 on ADR-0020's screen (Διαχείριση › Χρήστες): which rooms and which units
 * a clinical approver answers for.
 *
 * §6.4 routes an approval line through these rows and §9 decides what the
 * approver can see through the same ones, so getting this screen wrong is an
 * access-control failure and not a preferences bug.
 */
describe("approver scopes", () => {
  let app: INestApplication;
  let client: Client;
  let areas: AreaIds;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  async function userId(email: string): Promise<string> {
    const { rows } = await client.query("select id from ecapital.app_user where email = $1", [
      email,
    ]);
    return rows[0].id as string;
  }

  async function read(id: string, email: string = USERS.admin) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .get(`/admin/users/${id}/approver-scopes`)
      .set(bearer(token));
  }

  async function write(id: string, body: object, email: string = USERS.admin) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .put(`/admin/users/${id}/approver-scopes`)
      .set(bearer(token))
      .send(body);
  }

  it("reads what the seed appointed", async () => {
    const id = await userId("clinical.nicosia@ecapital.test");
    const response = await read(id);
    expect(response.status).toBe(200);
    const scopes = ApproverScopes.parse(response.body);
    // The seed gives the Infection Control officer the unit and two rooms.
    expect(scopes.units).toContainEqual({
      orgUnitId: "nicosia-general",
      role: "INFECTION_CONTROL",
    });
    expect(scopes.areas).toContainEqual({ areaId: areas.theatre, role: "WARD_MANAGER" });
    expect(scopes.areas).toContainEqual({ areaId: areas.icu, role: "WARD_MANAGER" });
  });

  it("replaces the whole picture and answers with what is now there", async () => {
    const id = await userId("nursing.nicosia@ecapital.test");
    const before = ApproverScopes.parse((await read(id)).body);
    expect(before.units).toContainEqual({ orgUnitId: "nicosia-general", role: "NURSING" });

    const replaced = await write(id, {
      areas: [{ areaId: areas.ward, role: "WARD_MANAGER" }],
      units: [
        { orgUnitId: "nicosia-general", role: "NURSING" },
        { orgUnitId: "nicosia-general", role: "INFECTION_CONTROL" },
      ],
    });
    expect(replaced.status).toBe(200);
    const after = ApproverScopes.parse(replaced.body);
    expect(after.areas).toEqual([{ areaId: areas.ward, role: "WARD_MANAGER" }]);
    expect(after.units).toHaveLength(2);

    // Put it back, so the rest of the suites see the seeded appointment.
    const restored = await write(id, { areas: [], units: before.units });
    expect(restored.status).toBe(200);
    expect(ApproverScopes.parse(restored.body).areas).toEqual([]);
  });

  it("records the change in the audit log (R42)", async () => {
    const id = await userId("director.nicosia@ecapital.test");
    const before = ApproverScopes.parse((await read(id)).body);
    await write(id, { areas: [{ areaId: areas.opd, role: "WARD_MANAGER" }], units: before.units });

    const { rows } = await client.query(
      `select action, actor_id from ecapital.audit_log
        where entity_type = 'area_clinical_owner'
          and after ->> 'user_id' = $1
        order by id desc limit 1`,
      [id],
    );
    expect(rows[0].action).toBe("INSERT");
    expect(rows[0].actor_id).toBe("dev-admin");

    await write(id, { areas: [], units: before.units });
  });

  it("refuses scopes on an account that does not hold the clinical approver role", async () => {
    const id = await userId("technician.nicosia@ecapital.test");
    const response = await write(id, {
      areas: [{ areaId: areas.ward, role: "WARD_MANAGER" }],
      units: [],
    });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.approverScopesNeedRole");
  });

  it("takes an empty replacement on any account, because clearing is not granting", async () => {
    const id = await userId("technician.nicosia@ecapital.test");
    const response = await write(id, { areas: [], units: [] });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ areas: [], units: [] });
  });

  it("refuses a ward manager over a whole unit and a director over one room", async () => {
    const id = await userId("clinical.nicosia@ecapital.test");
    const unitWide = await write(id, {
      areas: [],
      units: [{ orgUnitId: "nicosia-general", role: "WARD_MANAGER" }],
    });
    expect(unitWide.status).toBe(400);
    const perRoom = await write(id, {
      areas: [{ areaId: areas.ward, role: "HOSPITAL_DIRECTOR" }],
      units: [],
    });
    expect(perRoom.status).toBe(400);
  });

  it("answers 404 for an area or a unit that does not exist", async () => {
    const id = await userId("clinical.nicosia@ecapital.test");
    const noArea = await write(id, {
      areas: [{ areaId: "00000000-0000-0000-0000-000000000000", role: "WARD_MANAGER" }],
      units: [],
    });
    expect(noArea.status).toBe(404);
    const noUnit = await write(id, {
      areas: [],
      units: [{ orgUnitId: "no-such-unit", role: "NURSING" }],
    });
    expect(noUnit.status).toBe(404);
  });

  it("is an administrator's route and nobody else's", async () => {
    const id = await userId("clinical.nicosia@ecapital.test");
    for (const email of [USERS.estatesNicosia, USERS.clinicalNicosia, USERS.auditor]) {
      expect((await read(id, email)).status).toBe(403);
      expect((await write(id, { areas: [], units: [] }, email)).status).toBe(403);
    }
  });

  it("answers 404 for an account that does not exist", async () => {
    const response = await read("00000000-0000-0000-0000-000000000000");
    expect(response.status).toBe(404);
  });

  it("leaves the seeded appointments as it found them", async () => {
    // The suites that follow route permits through these, so the last word of
    // this file is that it put everything back.
    const clinical = await userId("clinical.nicosia@ecapital.test");
    const scopes = ApproverScopes.parse((await read(clinical)).body);
    expect(scopes.areas).toHaveLength(2);
    expect(scopes.units).toContainEqual({
      orgUnitId: "nicosia-general",
      role: "INFECTION_CONTROL",
    });
  });
});
