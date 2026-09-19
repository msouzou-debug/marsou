import type { INestApplication } from "@nestjs/common";
import { AffectedArea, SystemFeed } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { nicosiaAreas, type AreaIds } from "./permit-support";

/**
 * R19 and CAPEX-01 §6.1 — the system feeds and the indirect-impact answer.
 *
 * «Pulling a riser feeds theatres two floors up — model that with
 * serves_area_ids on the asset, and warn on indirect impact.»
 */
describe("system feeds and indirect impact", () => {
  let app: INestApplication;
  let areas: AreaIds;

  beforeAll(async () => {
    app = await createTestApp();
    areas = await nicosiaAreas(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists a unit's feeds to anybody who may read the unit", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .get("/system-feeds?orgUnitId=nicosia-general")
      .set(bearer(token));
    expect(response.status).toBe(200);
    const feeds = response.body.map((row: unknown) => SystemFeed.parse(row));
    expect(feeds.length).toBeGreaterThanOrEqual(3);
    const gas = feeds.find((feed: SystemFeed) => feed.system === "MEDICAL_GAS");
    expect(gas?.sourceAreaId).toBe(areas.plant);
    expect(gas?.servesAreaIds).toContain(areas.icu);
    expect(gas?.labelEl).toContain("ιατρικών αερίων");
  });

  it("shows a unit's feeds to nobody outside it", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get("/system-feeds?orgUnitId=nicosia-general")
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("is written by the head of estates and by nobody else", async () => {
    const body = {
      orgUnitId: "nicosia-general",
      system: "STEAM",
      sourceAreaId: areas.plant,
      servesAreaIds: [areas.ward],
      labelEl: `Ατμός δοκιμής ${Date.now()}`,
    };

    // A technician and the auditor can read the unit, so they get as far as
    // the policy and are refused by it.
    for (const email of [USERS.technicianNicosia, USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const refused = await request(app.getHttpServer())
        .post("/system-feeds")
        .set(bearer(token))
        .send(body);
      expect(refused.status).toBe(403);
    }
    // Somebody outside the unit never gets that far: the areas the body names
    // do not exist for them (ADR-0010), so it is 404 and not 403.
    const outside = await tokenFor(app, USERS.engineerLarnaca);
    const invisible = await request(app.getHttpServer())
      .post("/system-feeds")
      .set(bearer(outside))
      .send(body);
    expect(invisible.status).toBe(404);

    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post("/system-feeds")
      .set(bearer(token))
      .send(body);
    expect(created.status).toBe(201);
    const feed = SystemFeed.parse(created.body);

    const patched = await request(app.getHttpServer())
      .patch(`/system-feeds/${feed.id}`)
      .set(bearer(token))
      .send({ servesAreaIds: [areas.ward, areas.opd] });
    expect(patched.status).toBe(200);
    expect(patched.body.servesAreaIds).toHaveLength(2);

    const removed = await request(app.getHttpServer())
      .delete(`/system-feeds/${feed.id}`)
      .set(bearer(token));
    expect(removed.status).toBe(204);

    const gone = await request(app.getHttpServer())
      .patch(`/system-feeds/${feed.id}`)
      .set(bearer(token))
      .send({ labelEl: "Κάτι άλλο" });
    expect(gone.status).toBe(404);
  });

  it("refuses a feed that names an area of another unit", async () => {
    const admin = await tokenFor(app, USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .get("/org-units/larnaca-general/areas")
      .set(bearer(admin));
    const foreign = larnaca.body.buildings[0].floors[0].areas[0].id;

    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/system-feeds")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        system: "STEAM",
        sourceAreaId: null,
        servesAreaIds: [foreign],
        labelEl: `Λάθος μονάδα ${Date.now()}`,
      });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.permitAreaNotFound");
  });

  // -------------------------------------------------------- the impact --

  it("answers DIRECT for what was picked and INDIRECT for what is downstream", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(
        `/areas/impact?orgUnitId=nicosia-general&systems=MEDICAL_GAS&areaIds=${areas.plant}`,
      )
      .set(bearer(token));
    expect(response.status).toBe(200);
    const rows = response.body.map((row: unknown) => AffectedArea.parse(row));
    expect(rows[0].impact).toBe("DIRECT");
    expect(rows[0].areaId).toBe(areas.plant);
    expect(rows[0].viaSystem).toBeNull();

    const icu = rows.find((row: AffectedArea) => row.areaId === areas.icu);
    expect(icu.impact).toBe("INDIRECT");
    expect(icu.viaSystem).toBe("MEDICAL_GAS");
    // Each row carries what S11 draws next to it.
    expect(icu.patientRiskGroup).toBe("HIGHEST");
    expect(icu.areaType).toBe("ICU");
    expect(icu.buildingCode).toBe("NGH-A");
    expect(icu.floorCode).toBe("01");
    expect(icu.nameEl).toBe("Μονάδα Εντατικής Θεραπείας");
  });

  it("dedupes, and DIRECT wins", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(
        `/areas/impact?orgUnitId=nicosia-general&systems=MEDICAL_GAS&areaIds=${areas.plant},${areas.icu}`,
      )
      .set(bearer(token));
    const rows = response.body as AffectedArea[];
    const icuRows = rows.filter((row) => row.areaId === areas.icu);
    expect(icuRows).toHaveLength(1);
    expect(icuRows[0].impact).toBe("DIRECT");
  });

  it("fires a whole-unit feed whatever the engineer picked", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/areas/impact?orgUnitId=nicosia-general&systems=ELECTRICAL&areaIds=${areas.office}`)
      .set(bearer(token));
    expect(response.body).toHaveLength(6);
  });

  it("answers with the picked areas alone when no feed matches", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/areas/impact?orgUnitId=nicosia-general&systems=WATER&areaIds=${areas.ward}`)
      .set(bearer(token));
    expect(response.body).toHaveLength(1);
    expect(response.body[0].impact).toBe("DIRECT");
  });

  it("takes several systems at once", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(
        `/areas/impact?orgUnitId=nicosia-general&systems=MEDICAL_GAS,HVAC&areaIds=${areas.plant}`,
      )
      .set(bearer(token));
    const rows = response.body as AffectedArea[];
    expect(rows.map((row) => row.areaId)).toContain(areas.theatre);
    expect(rows.map((row) => row.areaId)).toContain(areas.icu);
  });

  it("refuses a query with no area on it", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/areas/impact?orgUnitId=nicosia-general&systems=WATER&areaIds=")
      .set(bearer(token));
    expect(response.status).toBe(400);
  });

  it("answers 404 for an area of a unit the caller cannot see", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/areas/impact?orgUnitId=nicosia-general&systems=WATER&areaIds=${areas.ward}`)
      .set(bearer(token));
    expect(response.status).toBe(404);
  });
});
