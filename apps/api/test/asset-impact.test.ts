import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * M4 meets M3 (CAPEX-01 §6.1, ADR-0028).
 *
 * §6.1 always said «model that with `serves_area_ids` on the asset»;
 * ADR-0026 recorded `system_feed` as a seam until the asset register
 * existed. It exists now, so `GET /areas/impact` asks the register first and
 * falls back to the feeds — **per system**, not per unit.
 *
 * Both paths are exercised here, and the seed is arranged so that both exist
 * in the same hospital: at Nicosia the medical gas is in the register and
 * the HVAC risers are not, which is what a half-surveyed hospital looks like.
 */
describe("indirect impact from the asset register", () => {
  let app: INestApplication;
  let admin: Client;
  let areas: Record<string, string>;

  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    const { rows } = await admin.query<{ code: string; id: string }>(
      "select code, id from ecapital.area where org_unit_id = 'nicosia-general'",
    );
    areas = Object.fromEntries(rows.map((r) => [r.code, r.id]));
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  async function impact(systems: string, areaIds: string[], email = USERS.estatesNicosia) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer())
      .get(
        `/areas/impact?orgUnitId=nicosia-general&systems=${systems}&areaIds=${areaIds.join(",")}`,
      )
      .set(bearer(token));
  }

  /** Path one: an asset carries the system and records what it serves. */
  it("takes the indirect impact from the asset when the register carries the system", async () => {
    const response = await impact("MEDICAL_GAS", [areas["PLT-01"]]);
    expect(response.status).toBe(200);

    const indirect = response.body.filter(
      (row: { impact: string }) => row.impact === "INDIRECT",
    );
    expect(indirect.map((row: { areaId: string }) => row.areaId).sort()).toEqual(
      [areas["ICU-01"], areas["THE-01"]].sort(),
    );
    expect(
      indirect.every((row: { viaSystem: string }) => row.viaSystem === "MEDICAL_GAS"),
    ).toBe(true);

    // The seeded manifold is the row that answered, and it is the one the
    // technician would be standing in front of.
    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::text as n from ecapital.asset
        where org_unit_id = 'nicosia-general' and system = 'MEDICAL_GAS'
          and cardinality(serves_area_ids) > 0`,
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
  });

  /**
   * And it fires wherever the asset happens to stand: the manifold is in the
   * plant room, but taking medical gas down anywhere in the unit interrupts
   * what the manifold feeds.
   */
  it("fires on the system, not on where the asset happens to sit", async () => {
    const response = await impact("MEDICAL_GAS", [areas["OPD-01"]]);
    const indirect = response.body.filter((row: { impact: string }) => row.impact === "INDIRECT");
    expect(indirect.map((row: { areaId: string }) => row.areaId).sort()).toEqual(
      [areas["ICU-01"], areas["THE-01"]].sort(),
    );
  });

  /** Path two: no asset carries the system yet, so the feed still answers. */
  it("falls back to the system feed for a system the register does not carry yet", async () => {
    const { rows } = await admin.query<{ n: string }>(
      `select count(*)::text as n from ecapital.asset
        where org_unit_id = 'nicosia-general' and system = 'HVAC'
          and cardinality(serves_area_ids) > 0`,
    );
    // The premise of this test: nobody has surveyed the HVAC risers.
    expect(Number(rows[0].n)).toBe(0);

    const response = await impact("HVAC", [areas["PLT-01"]]);
    const indirect = response.body.filter((row: { impact: string }) => row.impact === "INDIRECT");
    // The seeded feed: ΚΚΜ-1, from the plant room, serves the theatres.
    expect(indirect).toHaveLength(1);
    expect(indirect[0].areaId).toBe(areas["THE-01"]);
    expect(indirect[0].viaSystem).toBe("HVAC");
  });

  it("chooses per system, so one request can use both paths at once", async () => {
    // Steam is in neither the feeds nor the register, so an asset put there
    // answers for it while HVAC still comes off the feed — one request, both
    // paths, and two different rooms so neither hides the other.
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post("/assets")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        nameEl: `Λέβητας ατμού δοκιμής ${Date.now()}`,
        assetClass: "OTHER",
        criticality: 2,
        system: "STEAM",
        servesAreaIds: [areas["OPD-01"]],
      });
    expect(created.status).toBe(201);

    try {
      const response = await impact("STEAM,HVAC", [areas["PLT-01"]]);
      const indirect = response.body.filter(
        (row: { impact: string }) => row.impact === "INDIRECT",
      );
      const byArea = new Map<string, string>(
        indirect.map((row: { areaId: string; viaSystem: string }) => [row.areaId, row.viaSystem]),
      );
      // The register answered for steam, the feed for the air handling.
      expect(byArea.get(areas["OPD-01"])).toBe("STEAM");
      expect(byArea.get(areas["THE-01"])).toBe("HVAC");
    } finally {
      await admin.query("delete from ecapital.asset where id = $1", [created.body.id]);
    }
  });

  it("stops consulting the feed for a system once an asset carries it", async () => {
    // Record what ΚΚΜ-1 feeds, and the HVAC answer moves from the feed's
    // theatres to the asset's ward. This is the migration ADR-0028 describes,
    // performed on one asset.
    const { rows } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where name_el = 'Κλιματιστική μονάδα ΚΚΜ-1'",
    );
    const token = await tokenFor(app, USERS.estatesNicosia);
    try {
      const patched = await request(app.getHttpServer())
        .patch(`/assets/${rows[0].id}`)
        .set(bearer(token))
        .send({ servesAreaIds: [areas["WRD-01"]] });
      expect(patched.status).toBe(200);

      const response = await impact("HVAC", [areas["PLT-01"]]);
      const indirect = response.body.filter(
        (row: { impact: string }) => row.impact === "INDIRECT",
      );
      expect(indirect).toHaveLength(1);
      expect(indirect[0].areaId).toBe(areas["WRD-01"]);
      expect(indirect[0].viaSystem).toBe("HVAC");
    } finally {
      await admin.query("update ecapital.asset set serves_area_ids = '{}' where id = $1", [
        rows[0].id,
      ]);
    }
  });

  it("does not let a disposed asset answer for anything", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post("/assets")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        nameEl: `Αποσυρμένος λέβητας ${Date.now()}`,
        assetClass: "OTHER",
        criticality: 3,
        system: "STEAM",
        servesAreaIds: [areas["WRD-01"]],
        status: "DISPOSED",
      });
    expect(created.status).toBe(201);

    const response = await impact("STEAM", [areas["PLT-01"]]);
    expect(response.body.filter((row: { impact: string }) => row.impact === "INDIRECT")).toEqual(
      [],
    );
  });
});
