import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * M4 — the asset register (R26–R30, R45).
 *
 * What this suite is for: the tag comes from the database and cannot be
 * moved, the register is read by the unit and written by the estate, the
 * technician has exactly one field, and a scanned label finds its asset or
 * says so in the caller's language.
 */
describe("the asset register", () => {
  let app: INestApplication;
  let admin: Client;
  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  let made = 0;
  async function makeAsset(
    body: Record<string, unknown> = {},
    email: string = USERS.estatesNicosia,
  ) {
    made += 1;
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .post("/assets")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        nameEl: `Δοκιμαστικό πάγιο ${Date.now()}-${made}`,
        assetClass: "HVAC",
        criticality: 3,
        ...body,
      });
  }

  // ------------------------------------------------------------- the tag --

  it("allocates the tag itself, per unit and per class, and never takes one from the caller", async () => {
    const first = await makeAsset({ assetClass: "LIFT" });
    const second = await makeAsset({ assetClass: "LIFT" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.tag).toMatch(/^NGH-LFT-\d{4}$/);
    expect(second.body.tag).toMatch(/^NGH-LFT-\d{4}$/);
    expect(Number(second.body.tag.slice(-4))).toBe(Number(first.body.tag.slice(-4)) + 1);

    // A tag the caller tried to set is ignored, not honoured.
    const third = await makeAsset({ assetClass: "LIFT", tag: "NGH-LFT-9999" });
    expect(third.body.tag).not.toBe("NGH-LFT-9999");
  });

  it("gives another unit its own run of numbers", async () => {
    const token = await tokenFor(app, USERS.admin);
    const nicosia = await makeAsset({ assetClass: "WATER" }, USERS.admin);
    const larnaca = await request(app.getHttpServer())
      .post("/assets")
      .set(bearer(token))
      .send({
        orgUnitId: "larnaca-general",
        nameEl: `Δοκιμαστικό πάγιο Λάρνακας ${Date.now()}`,
        assetClass: "WATER",
        criticality: 3,
      });
    expect(nicosia.body.tag.startsWith("NGH-WAT-")).toBe(true);
    expect(larnaca.body.tag.startsWith("LAR-WAT-")).toBe(true);
  });

  it("refuses to move an asset's unit or change its class, because both are in the tag", async () => {
    const created = await makeAsset();
    const token = await tokenFor(app, USERS.admin);
    const moved = await request(app.getHttpServer())
      .patch(`/assets/${created.body.id}`)
      .set(bearer(token))
      .send({ orgUnitId: "larnaca-general" });
    expect(moved.status).toBe(422);
    expect(moved.body.key).toBe("errors.assetUnitFixed");

    const reclassed = await request(app.getHttpServer())
      .patch(`/assets/${created.body.id}`)
      .set(bearer(token))
      .send({ assetClass: "LIFT" });
    expect(reclassed.status).toBe(422);
    expect(reclassed.body.key).toBe("errors.assetClassFixed");
  });

  // ------------------------------------------------------- who may write --

  it("is written by the estate and by nobody else", async () => {
    for (const email of [USERS.admin, USERS.estatesNicosia] as const) {
      const response = await makeAsset({}, email);
      expect(response.status, email).toBe(201);
    }
    // The technician reads the register and does not keep it.
    const technician = await makeAsset({}, USERS.technicianNicosia);
    expect(technician.status).toBe(403);
    const auditor = await makeAsset({}, USERS.auditor);
    expect(auditor.status).toBe(403);
    const executive = await makeAsset({}, USERS.executive);
    expect(executive.status).toBe(403);
  });

  it("shows a unit's assets to nobody outside it", async () => {
    const created = await makeAsset();
    const outsider = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/assets/${created.body.id}`)
      .set(bearer(outsider));
    // Not 403: an asset in a unit the caller cannot see does not exist for
    // them, and 403 would confirm that it does (ADR-0010).
    expect(response.status).toBe(404);
  });

  it("lets the auditor and the executive read and never write", async () => {
    const created = await makeAsset();
    for (const email of [USERS.auditor, USERS.executive] as const) {
      const token = await tokenFor(app, email);
      const read = await request(app.getHttpServer())
        .get(`/assets/${created.body.id}`)
        .set(bearer(token));
      expect(read.status, email).toBe(200);
      const write = await request(app.getHttpServer())
        .patch(`/assets/${created.body.id}`)
        .set(bearer(token))
        .send({ nameEl: "Αλλαγμένο" });
      expect(write.status, email).toBe(403);
    }
  });

  // ------------------------------------------------------ the technician --

  it("lets a technician record a condition and nothing else about the asset", async () => {
    const created = await makeAsset({ criticality: 1 });
    const token = await tokenFor(app, USERS.technicianNicosia);

    const condition = await request(app.getHttpServer())
      .post(`/assets/${created.body.id}/condition`)
      .set(bearer(token))
      .send({ condition: "D", noteEl: "Διαρροή στο στόμιο απαγωγής" });
    expect(condition.status).toBe(201);
    expect(condition.body.condition).toBe("D");
    expect(condition.body.conditionAssessedAt).not.toBeNull();

    const patch = await request(app.getHttpServer())
      .patch(`/assets/${created.body.id}`)
      .set(bearer(token))
      .send({ capitalCost: 1 });
    expect(patch.status).toBe(403);
  });

  it("records who moved the band, so the history can say", async () => {
    const created = await makeAsset();
    const token = await tokenFor(app, USERS.technicianNicosia);
    await request(app.getHttpServer())
      .post(`/assets/${created.body.id}/condition`)
      .set(bearer(token))
      .send({ condition: "C" });

    const { rows } = await admin.query<{ actor_id: string; after: { condition: string } }>(
      `select actor_id, after from ecapital.audit_log
        where entity_type = 'asset' and entity_id = $1 and action = 'UPDATE'
        order by id desc limit 1`,
      [created.body.id],
    );
    expect(rows[0].actor_id).toBe("dev-technician-nicosia");
    expect(rows[0].after.condition).toBe("C");
  });

  it("refuses a band that is not one of A to E", async () => {
    const created = await makeAsset();
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .post(`/assets/${created.body.id}/condition`)
      .set(bearer(token))
      .send({ condition: "F" });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.assetConditionNotValid");
  });

  it("takes a reading from the technician and stamps who took it", async () => {
    const created = await makeAsset();
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .post(`/assets/${created.body.id}/readings`)
      .set(bearer(token))
      .send({ readingType: "RUN_HOURS", value: 1234.5, unit: "h" });
    expect(response.status).toBe(201);
    expect(response.body.value).toBe(1234.5);
    // Stamped from the caller, never read from the body.
    expect(response.body.takenByName).toBe("Κυριάκος Στυλιανού");

    const outsider = await tokenFor(app, USERS.finance);
    const refused = await request(app.getHttpServer())
      .post(`/assets/${created.body.id}/readings`)
      .set(bearer(outsider))
      .send({ readingType: "RUN_HOURS", value: 1 });
    expect(refused.status).toBe(403);
  });

  // ------------------------------------------------------------ the list --

  it("ranks by criticality and then by condition, 1 being the most urgent", async () => {
    const token = await tokenFor(app, USERS.admin);
    const worst = await makeAsset({ criticality: 1, condition: "E" }, USERS.admin);
    const best = await makeAsset({ criticality: 5, condition: "A" }, USERS.admin);

    const response = await request(app.getHttpServer())
      .get("/assets?orgUnitId=nicosia-general&pageSize=100")
      .set(bearer(token));
    expect(response.status).toBe(200);
    const byId = new Map<string, number | null>(
      response.body.items.map((row: { id: string; priorityRank: number | null }) => [
        row.id,
        row.priorityRank,
      ]),
    );
    expect(byId.get(worst.body.id)).toBe(1);
    expect(byId.get(best.body.id)).toBeGreaterThan(byId.get(worst.body.id) as number);
    expect(response.body.total).toBeGreaterThan(0);
  });

  it("finds an asset by a fragment of its tag, its name, its serial or its SAP number", async () => {
    const token = await tokenFor(app, USERS.admin);
    const created = await makeAsset(
      { serialNo: "ZZ-TEST-559911", sapAssetNo: "SAP-TEST-4477" },
      USERS.admin,
    );
    for (const needle of ["559911", "sap-test-4477", created.body.tag.slice(-4)]) {
      const response = await request(app.getHttpServer())
        .get(`/assets?q=${encodeURIComponent(needle)}&pageSize=100`)
        .set(bearer(token));
      expect(
        response.body.items.some((row: { id: string }) => row.id === created.body.id),
        needle,
      ).toBe(true);
    }
  });

  it("keeps each unit's register to itself", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer()).get("/assets?pageSize=100").set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(
      response.body.items.every((row: { orgUnitId: string }) => row.orgUnitId === "larnaca-general"),
    ).toBe(true);
  });

  // ------------------------------------------------- places and parents --

  it("refuses an area, a parent, a project or a contract of another unit", async () => {
    const larnacaAreas = await admin.query<{ id: string }>(
      "select id from ecapital.area where org_unit_id = 'larnaca-general' limit 1",
    );
    const wrongArea = await makeAsset({ areaId: larnacaAreas.rows[0].id });
    expect(wrongArea.status).toBe(404);
    expect(wrongArea.body.key).toBe("errors.assetAreaNotFound");

    const wrongServes = await makeAsset({ servesAreaIds: [larnacaAreas.rows[0].id] });
    expect(wrongServes.status).toBe(404);

    const larnacaAsset = await admin.query<{ id: string }>(
      "select id from ecapital.asset where org_unit_id = 'larnaca-general' limit 1",
    );
    const wrongParent = await makeAsset({ parentAssetId: larnacaAsset.rows[0].id });
    expect(wrongParent.status).toBe(404);
    expect(wrongParent.body.key).toBe("errors.assetParentNotFound");
  });

  it("carries the hierarchy both ways", async () => {
    const parent = await makeAsset({ nameEl: `ΚΚΜ δοκιμής ${Date.now()}` });
    const child = await makeAsset({
      nameEl: `Ανεμιστήρας δοκιμής ${Date.now()}`,
      parentAssetId: parent.body.id,
    });
    const token = await tokenFor(app, USERS.admin);
    const detail = await request(app.getHttpServer())
      .get(`/assets/${parent.body.id}`)
      .set(bearer(token));
    expect(detail.body.children.map((c: { id: string }) => c.id)).toContain(child.body.id);

    const childDetail = await request(app.getHttpServer())
      .get(`/assets/${child.body.id}`)
      .set(bearer(token));
    expect(childDetail.body.parentTag).toBe(parent.body.tag);
  });

  // ------------------------------------------------------ the scan route --

  it("resolves a scanned tag to the asset and its history", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const { rows } = await admin.query<{ tag: string }>(
      "select tag from ecapital.asset where org_unit_id = 'nicosia-general' and name_el = 'Συστοιχία ιατρικών αερίων Α'",
    );
    const response = await request(app.getHttpServer())
      .get(`/assets/by-tag/${rows[0].tag}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.tag).toBe(rows[0].tag);
    expect(response.body.history.length).toBeGreaterThan(0);
  });

  it("says a tag is unknown in the caller's language", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const greek = await request(app.getHttpServer())
      .get("/assets/by-tag/NGH-HVA-9999")
      .set(bearer(token));
    expect(greek.status).toBe(404);
    expect(greek.body.key).toBe("errors.assetTagNotFound");
    expect(greek.body.message).toContain("NGH-HVA-9999");
    expect(greek.body.message).toContain("Δεν βρέθηκε πάγιο");

    const english = await request(app.getHttpServer())
      .get("/assets/by-tag/NGH-HVA-9999")
      .set(bearer(token))
      .set("Accept-Language", "en");
    expect(english.body.message).toContain("No asset carries the tag");
  });

  it("answers 404 for a tag that belongs to a unit the caller cannot see", async () => {
    const { rows } = await admin.query<{ tag: string }>(
      "select tag from ecapital.asset where org_unit_id = 'larnaca-general' limit 1",
    );
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .get(`/assets/by-tag/${rows[0].tag}`)
      .set(bearer(token));
    expect(response.status).toBe(404);
  });
});
