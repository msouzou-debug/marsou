import type { INestApplication } from "@nestjs/common";
import { IcraMatrixVersion, IcraResult } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { nicosiaAreas, type AreaIds } from "./permit-support";
import { seedIcraCells } from "../src/db/seed-data";

/**
 * R20 — the ICRA matrix as versioned reference data (CAPEX-01 §6.2).
 *
 * «ΟΚΥπΥ Infection Control approves the local edition and can amend it
 * without a release.» That is what these routes are for, and what the tests
 * below check is that amending it is always a *new version* — the one thing
 * that keeps a permit signed in March readable in November.
 */
describe("the ICRA matrix", () => {
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
    // Leave the seeded edition active for the suites that run after this one.
    await client.query(
      `update ecapital.icra_matrix_version set status = 'RETIRED' where status = 'ACTIVE' and id <> 'OKYPY-ICRA-2.0-2026.1'`,
    );
    await client.query(
      `update ecapital.icra_matrix_version set status = 'ACTIVE' where id = 'OKYPY-ICRA-2.0-2026.1'`,
    );
    await client.end();
    await app.close();
  });

  it("serves the ACTIVE edition to any signed-in role", async () => {
    for (const email of [USERS.technicianNicosia, USERS.clinicalNicosia, USERS.auditor]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
      expect(response.status).toBe(200);
      const matrix = IcraMatrixVersion.parse(response.body);
      expect(matrix.id).toBe("OKYPY-ICRA-2.0-2026.1");
      expect(matrix.status).toBe("ACTIVE");
      expect(matrix.basedOn).toBe("ASHE ICRA 2.0 (2022)");
      expect(matrix.effectiveFrom).toBe("2026-01-01");
      expect(matrix.cells).toHaveLength(16);
    }
  });

  it("ships the seeded edition marked as still waiting on Infection Control (§6.2)", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
    expect(response.body.notesEl).toBe("Προς επικύρωση από την Επιτροπή Ελέγχου Λοιμώξεων");
    // Not approved by anybody yet: activation is what records that.
    expect(response.body.approvedByName).toBeNull();
  });

  it("carries the brief's two hard cells (CAPEX-01 §2)", async () => {
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const response = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
    const cells = (response.body as IcraMatrixVersion).cells;
    const cell = (activityType: string, riskGroup: string) =>
      cells.find((c) => c.activityType === activityType && c.riskGroup === riskGroup);
    // «Type C in a high-risk area is Class IV, not III.»
    expect(cell("C", "HIGH")?.icraClass).toBe("IV");
    expect(cell("D", "HIGHEST")?.icraClass).toBe("V");
  });

  it("lists every edition for an administrator and for a clinical approver only", async () => {
    for (const email of [USERS.admin, USERS.clinicalNicosia]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .get("/icra/matrix/versions")
        .set(bearer(token));
      expect(response.status).toBe(200);
      expect(response.body.length).toBeGreaterThan(0);
    }
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const refused = await request(app.getHttpServer())
      .get("/icra/matrix/versions")
      .set(bearer(engineer));
    expect(refused.status).toBe(403);
  });

  it("runs the engine without storing anything", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/icra/evaluate")
      .set(bearer(token))
      .send({
        activityType: "C",
        affectedAreaIds: [areas.theatre],
        surrounding: [],
        workKind: "MAINTENANCE",
      });
    expect(response.status).toBe(200);
    const result = IcraResult.parse(response.body);
    expect(result.icraClass).toBe("IV");
    expect(result.riskGroup).toBe("HIGHEST");
    expect(result.riskGroupFromAreaId).toBe(areas.theatre);
    expect(result.permitRequired).toBe(true);
    expect(result.refusalKey).toBeNull();

    const { rows } = await client.query("select count(*)::int as n from ecapital.shutdown_permit");
    const again = await request(app.getHttpServer())
      .post("/icra/evaluate")
      .set(bearer(token))
      .send({
        activityType: "C",
        affectedAreaIds: [areas.theatre],
        surrounding: [],
        workKind: "MAINTENANCE",
      });
    expect(again.status).toBe(200);
    const { rows: after } = await client.query(
      "select count(*)::int as n from ecapital.shutdown_permit",
    );
    expect(after[0].n).toBe(rows[0].n);
  });

  it("answers the refusal key rather than refusing the request itself", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/icra/evaluate")
      .set(bearer(token))
      .send({
        activityType: "B",
        affectedAreaIds: [areas.office],
        surrounding: [],
        workKind: "CONSTRUCTION",
      });
    expect(response.status).toBe(200);
    expect(response.body.icraClass).toBe("II");
    expect(response.body.refusalKey).toBe("classTwoInvalidForWorks");
  });

  it("takes the risk group from the surrounding assessment when it is the worst", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/icra/evaluate")
      .set(bearer(token))
      .send({
        activityType: "B",
        affectedAreaIds: [areas.office],
        surrounding: [{ side: "ABOVE", areaId: areas.icu, patientRiskGroup: null, noteEl: null }],
        workKind: "MAINTENANCE",
      });
    expect(response.status).toBe(200);
    // The band comes from the area register, not from the body.
    expect(response.body.riskGroup).toBe("HIGHEST");
    expect(response.body.riskGroupFromAreaId).toBe(areas.icu);
  });

  it("answers 404 for an area the caller cannot see", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .post("/icra/evaluate")
      .set(bearer(token))
      .send({
        activityType: "A",
        affectedAreaIds: [areas.theatre],
        surrounding: [],
        workKind: "INSPECTION",
      });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.permitAreaNotFound");
  });

  // ------------------------------------------------------- a new edition --

  it("publishes a new edition as DRAFT and activates it, retiring the one before", async () => {
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const id = `OKYPY-ICRA-2.0-TEST-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post("/icra/matrix/versions")
      .set(bearer(token))
      .send({
        id,
        basedOn: "ASHE ICRA 2.0 (2022)",
        effectiveFrom: "2027-01-01",
        notesEl: "Εγκρίθηκε από την Επιτροπή Ελέγχου Λοιμώξεων",
        approvedByName: "Επιτροπή Ελέγχου Λοιμώξεων",
        cells: seedIcraCells,
      });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("DRAFT");
    expect(created.body.cells).toHaveLength(16);
    // A draft is not the matrix yet.
    const still = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
    expect(still.body.id).toBe("OKYPY-ICRA-2.0-2026.1");

    const activated = await request(app.getHttpServer())
      .post(`/icra/matrix/versions/${id}/activate`)
      .set(bearer(token));
    expect(activated.status).toBe(200);
    expect(activated.body.status).toBe("ACTIVE");
    expect(activated.body.approvedAt).not.toBeNull();

    const now = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
    expect(now.body.id).toBe(id);

    const { rows } = await client.query(
      "select status from ecapital.icra_matrix_version where id = 'OKYPY-ICRA-2.0-2026.1'",
    );
    expect(rows[0].status).toBe("RETIRED");

    // R42: activating an edition is a decision, and it is in the trail.
    const { rows: audit } = await client.query(
      "select action from ecapital.audit_log where entity_type = 'icra_matrix_version' and entity_id = $1 order by id",
      [id],
    );
    expect(audit.map((row) => row.action)).toEqual(["INSERT", "UPDATE"]);

    // RULE (§6.2): a retired edition never comes back. Reinstating one is
    // publishing it again under a new id, so the trail says who decided to.
    const reinstate = await request(app.getHttpServer())
      .post("/icra/matrix/versions/OKYPY-ICRA-2.0-2026.1/activate")
      .set(bearer(token));
    expect(reinstate.status).toBe(422);
    expect(reinstate.body.key).toBe("errors.icraMatrixRetired");

    // Which is why the suites that follow get the seeded edition back through
    // the database and not through a route: there is no route for it.
    await client.query(
      `update ecapital.icra_matrix_version set status = 'RETIRED' where id = $1`,
      [id],
    );
    await client.query(
      `update ecapital.icra_matrix_version set status = 'ACTIVE' where id = 'OKYPY-ICRA-2.0-2026.1'`,
    );
    const back = await request(app.getHttpServer()).get("/icra/matrix").set(bearer(token));
    expect(back.body.id).toBe("OKYPY-ICRA-2.0-2026.1");
  });

  it("refuses an edition that does not carry all sixteen cells", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post("/icra/matrix/versions")
      .set(bearer(token))
      .send({
        id: `OKYPY-ICRA-SHORT-${Date.now()}`,
        basedOn: "ASHE ICRA 2.0 (2022)",
        effectiveFrom: "2027-01-01",
        notesEl: null,
        approvedByName: null,
        cells: seedIcraCells.slice(0, 15),
      });
    // The contract says sixteen, so the body never reaches the service.
    expect(response.status).toBe(400);
  });

  it("refuses an edition from an engineer and from a read-only account", async () => {
    for (const email of [USERS.engineerLarnaca, USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .post("/icra/matrix/versions")
        .set(bearer(token))
        .send({
          id: `OKYPY-ICRA-NO-${Date.now()}`,
          basedOn: "ASHE ICRA 2.0 (2022)",
          effectiveFrom: "2027-01-01",
          notesEl: null,
          approvedByName: null,
          cells: seedIcraCells,
        });
      expect(response.status).toBe(403);
    }
  });

  it("refuses a clinical approver who does not hold Infection Control", async () => {
    // The Nursing officer is a clinical_approver too, and the matrix is not
    // theirs: §6.2 gives the local edition to Infection Control.
    const token = await tokenFor(app, "nursing.nicosia@ecapital.test");
    const response = await request(app.getHttpServer())
      .post("/icra/matrix/versions")
      .set(bearer(token))
      .send({
        id: `OKYPY-ICRA-NURSE-${Date.now()}`,
        basedOn: "ASHE ICRA 2.0 (2022)",
        effectiveFrom: "2027-01-01",
        notesEl: null,
        approvedByName: null,
        cells: seedIcraCells,
      });
    expect(response.status).toBe(403);
  });

  it("refuses a second edition with the same id", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post("/icra/matrix/versions")
      .set(bearer(token))
      .send({
        id: "OKYPY-ICRA-2.0-2026.1",
        basedOn: "ASHE ICRA 2.0 (2022)",
        effectiveFrom: "2027-01-01",
        notesEl: null,
        approvedByName: null,
        cells: seedIcraCells,
      });
    expect(response.status).toBe(409);
    expect(response.body.key).toBe("errors.icraMatrixIdTaken");
  });

  it("refuses to activate the edition that is already active", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post("/icra/matrix/versions/OKYPY-ICRA-2.0-2026.1/activate")
      .set(bearer(token));
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.icraMatrixAlreadyActive");
  });

  it("answers 404 for an edition nobody published", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post("/icra/matrix/versions/no-such-edition/activate")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.icraMatrixNotFound");
  });
});
