import type { INestApplication } from "@nestjs/common";
import { AreaTree } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * The M0 definition of done, in one file: a user logs in and sees their own
 * unit's area tree and nothing else. Nothing here asks the service for
 * permission — row-level security is what decides, and these tests prove it
 * by asking as four different people.
 */
describe("GET /org-units/:id/areas", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("gives the head of estates at Nicosia the Nicosia tree", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/org-units/nicosia-general/areas")
      .set(bearer(token));

    expect(response.status).toBe(200);
    const tree = AreaTree.parse(response.body);
    expect(tree.buildings).toHaveLength(1);
    expect(tree.buildings[0].floors).toHaveLength(2);
    expect(tree.buildings[0].floors.flatMap((f) => f.areas)).toHaveLength(6);

    const theatre = tree.buildings[0].floors
      .flatMap((f) => f.areas)
      .find((a) => a.areaType === "THEATRE");
    expect(theatre?.patientRiskGroup).toBe("HIGHEST");
  });

  it("answers 404 for a unit the caller is not in", async () => {
    // Not 403. Under the policy the Larnaca rows do not exist for this user,
    // so the honest answer is the same one a misspelt id gets. A 403 would
    // confirm the unit exists, which is the one fact they should not learn.
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.unitNotFound");
  });

  it("answers 404 the same way for a unit that does not exist", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/org-units/no-such-unit/areas")
      .set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.unitNotFound");
  });

  it("gives the administrator both units", async () => {
    const token = await tokenFor(app, USERS.admin);
    const nicosia = await request(app.getHttpServer())
      .get("/org-units/nicosia-general/areas")
      .set(bearer(token));
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(token));

    expect(nicosia.status).toBe(200);
    expect(larnaca.status).toBe(200);
    expect(AreaTree.parse(nicosia.body).buildings.length).toBeGreaterThan(0);
    // Larnaca has no building seeded yet; it is reachable, which is the point.
    expect(AreaTree.parse(larnaca.body).orgUnitId).toBe("larnaca-general");
  });

  it("gives the auditor both units", async () => {
    const token = await tokenFor(app, USERS.auditor);
    for (const unit of ["nicosia-general", "larnaca-general"]) {
      const response = await request(app.getHttpServer())
        .get(`/org-units/${unit}/areas`)
        .set(bearer(token));
      expect(response.status).toBe(200);
    }
  });

  it("refuses a caller with no token", async () => {
    const response = await request(app.getHttpServer()).get("/org-units/nicosia-general/areas");
    expect(response.status).toBe(401);
  });
});

describe("POST /org-units/:id/areas", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function nicosiaGroundFloorId(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get("/org-units/nicosia-general/areas")
      .set(bearer(token));
    return AreaTree.parse(response.body).buildings[0].floors[0].id;
  }

  it("lets the head of estates add an area to their own unit", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const floorId = await nicosiaGroundFloorId(token);
    const response = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({
        floorId,
        code: `LAB-${Date.now()}`,
        nameEl: "Εργαστήριο Μικροβιολογίας",
        areaType: "LAB",
        patientRiskGroup: "MEDIUM",
      });
    expect(response.status).toBe(201);
    expect(response.body.areaType).toBe("LAB");
  });

  it("refuses a body that is not a valid area", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const floorId = await nicosiaGroundFloorId(token);
    const response = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({ floorId, code: "X", nameEl: "X", areaType: "CANTEEN", patientRiskGroup: "MEDIUM" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.areaNotValid");
  });

  it("refuses the auditor, who reads and never writes", async () => {
    // The refusal comes from the write policy, not from a check in the
    // controller: auditor_readonly fails ecapital.can_write_unit().
    const estatesToken = await tokenFor(app, USERS.estatesNicosia);
    const floorId = await nicosiaGroundFloorId(estatesToken);
    const token = await tokenFor(app, USERS.auditor);
    const response = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({
        floorId,
        code: `AUD-${Date.now()}`,
        nameEl: "Δοκιμή",
        areaType: "OFFICE",
        patientRiskGroup: "LOW",
      });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.readOnlyAccount");
  });

  it("refuses the executive, who also reads and never writes", async () => {
    // Owner decision 18/09/2026: executive_readonly is read-only at the policy
    // level, same as the auditor (ADR-0010).
    const estatesToken = await tokenFor(app, USERS.estatesNicosia);
    const floorId = await nicosiaGroundFloorId(estatesToken);
    const token = await tokenFor(app, USERS.executive);
    const response = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({
        floorId,
        code: `EXE-${Date.now()}`,
        nameEl: "Δοκιμή",
        areaType: "OFFICE",
        patientRiskGroup: "LOW",
      });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.readOnlyAccount");
  });

  it("refuses an engineer writing into somebody else's unit", async () => {
    const estatesToken = await tokenFor(app, USERS.estatesNicosia);
    const floorId = await nicosiaGroundFloorId(estatesToken);
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .post("/org-units/nicosia-general/areas")
      .set(bearer(token))
      .send({
        floorId,
        code: `LAR-${Date.now()}`,
        nameEl: "Δοκιμή",
        areaType: "OFFICE",
        patientRiskGroup: "LOW",
      });
    expect(response.status).toBe(404);
  });
});
