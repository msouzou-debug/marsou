import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * M4's definition of done: «a technician scans a QR label and sees the full
 * history». This suite is that sentence, taken apart.
 *
 * The seeded medical-gas manifold is the asset it is taken apart on: it is
 * the one with papers already filed with eArchive, readings, and areas it
 * serves that the seeded permits touch.
 */
describe("the asset detail and its history", () => {
  let app: INestApplication;
  let admin: Client;
  let manifoldId: string;
  let liftId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
    const { rows } = await admin.query<{ id: string; name_el: string }>(
      `select id, name_el from ecapital.asset
        where org_unit_id = 'nicosia-general'
          and name_el in ('Συστοιχία ιατρικών αερίων Α', 'Ανελκυστήρας Α1, κτίριο Α')`,
    );
    const byName = new Map(rows.map((r) => [r.name_el, r.id]));
    manifoldId = byName.get("Συστοιχία ιατρικών αερίων Α") as string;
    liftId = byName.get("Ανελκυστήρας Α1, κτίριο Α") as string;
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  async function detail(id: string, email: string = USERS.technicianNicosia) {
    const token = await tokenFor(app, email);
    return request(app.getHttpServer()).get(`/assets/${id}`).set(bearer(token));
  }

  it("names the place, the unit and the building it sits in", async () => {
    const response = await detail(manifoldId);
    expect(response.status).toBe(200);
    expect(response.body.areaNameEl).toBe("Μηχανοστάσιο");
    expect(response.body.orgUnitNameEl).toBe("Γενικό Νοσοκομείο Λευκωσίας");
    expect(response.body.buildingCode).toBe("NGH-A");
    expect(response.body.floorCode).toBe("00");
  });

  it("leaves the place empty for plant that belongs to the building and not to a room", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where name_el = 'Ψύκτης Ψ-1, δώμα κτιρίου Α'",
    );
    const response = await detail(rows[0].id);
    expect(response.body.areaId).toBeNull();
    expect(response.body.areaNameEl).toBeNull();
    expect(response.body.buildingCode).toBeNull();
  });

  it("carries the source project's code and the contract's reference (R27)", async () => {
    const response = await detail(liftId);
    expect(response.body.sourceProjectCode).toMatch(/^NGH-\d{4}-\d{3}$/);
    expect(response.body.sourceContractRef).toMatch(/^CAP-\d{4}-\d{4}$/);
    const kinds = response.body.history.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain("PROJECT");
    expect(kinds).toContain("CONTRACT");
  });

  it("assembles the history newest first, in Greek, with a link on each line", async () => {
    const response = await detail(manifoldId);
    const history = response.body.history as {
      at: string;
      kind: string;
      summaryEl: string;
      href: string | null;
    }[];
    expect(history.length).toBeGreaterThan(2);
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i - 1].at >= history[i].at).toBe(true);
    }
    expect(history.every((entry) => entry.summaryEl.trim().length > 0)).toBe(true);
    expect(history.every((entry) => entry.href !== null)).toBe(true);
    // The register was written by the seed, so there is a CREATED line.
    expect(history.map((entry) => entry.kind)).toContain("CREATED");
  });

  it("puts the readings and the filed papers on the history", async () => {
    const response = await detail(manifoldId);
    const kinds = response.body.history.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain("READING");
    expect(kinds).toContain("DOCUMENT");
    expect(response.body.readings.length).toBe(2);
    expect(response.body.documents.length).toBe(2);
    // The two seeded papers came back from eArchive with a protocol number.
    expect(
      response.body.documents.every((doc: { protocolNumber: string | null }) =>
        doc.protocolNumber?.startsWith("ΤΥ/"),
      ),
    ).toBe(true);
    expect(
      response.body.documents.every((doc: { filedAt: string | null }) => doc.filedAt !== null),
    ).toBe(true);
  });

  it("adds a CONDITION line when a technician moves the band", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const before = await detail(manifoldId);
    const band = before.body.condition === "C" ? "B" : "C";
    await request(app.getHttpServer())
      .post(`/assets/${manifoldId}/condition`)
      .set(bearer(token))
      .send({ condition: band });

    const after = await detail(manifoldId);
    const line = (after.body.history as { kind: string; summaryEl: string; actorName: string }[])
      .find((entry) => entry.kind === "CONDITION");
    expect(line).toBeDefined();
    expect(line?.summaryEl).toContain("Φυσική κατάσταση");
    expect(line?.actorName).toBe("Κυριάκος Στυλιανού");
  });

  it("lists the permits that touch the rooms the asset serves", async () => {
    const response = await detail(manifoldId);
    const kinds = response.body.history.map((entry: { kind: string }) => entry.kind);
    expect(kinds).toContain("PERMIT");
    // The seeded register has permits on the ICU and the theatres that are
    // not closed; the manifold serves both.
    expect(response.body.openPermits.length).toBeGreaterThan(0);
    expect(
      response.body.openPermits.every((p: { status: string }) => p.status !== "CLOSED"),
    ).toBe(true);
  });

  it("leaves work orders and defects to M5 and returns what exists", async () => {
    const response = await detail(manifoldId);
    const kinds = response.body.history.map((entry: { kind: string }) => entry.kind);
    expect(kinds).not.toContain("WORK_ORDER");
    expect(kinds).not.toContain("DEFECT");
    // `openDefects` counts open handover defects on the asset. Nothing has
    // recorded one yet, so it is nought and not missing.
    expect(response.body.openDefects).toBe(0);
  });

  it("counts an open handover defect once one names the asset", async () => {
    const { rows } = await admin.query<{ id: string }>(
      `insert into ecapital.defect
         (org_unit_id, source, asset_id, description_el, risk_band, status, raised_by)
       select 'nicosia-general', 'HANDOVER', $1, 'Δοκιμαστική έλλειψη παράδοσης', 'HIGH', 'OPEN', u.id
         from ecapital.app_user u where u.subject = 'dev-admin'
       returning id`,
      [manifoldId],
    );
    try {
      const response = await detail(manifoldId);
      expect(response.body.openDefects).toBe(1);
    } finally {
      await admin.query("delete from ecapital.defect where id = $1", [rows[0].id]);
    }
  });

  // ------------------------------------------------------- whole life --

  it("computes the age and what is left of the expected life, and nothing more", async () => {
    const response = await detail(manifoldId);
    const life = response.body.wholeLife;
    expect(life.capitalCost).toBe(64000);
    expect(life.replacementCostEst).toBe(92000);
    expect(life.replacementYear).toBe(2030);
    expect(life.ageYears).toBeGreaterThan(5);
    expect(life.remainingLifeYears).toBeGreaterThanOrEqual(0);
    expect(life.remainingLifeYears).toBeLessThanOrEqual(15);
    // R30 is lean by the owner steer: maintenance to date waits for M5's
    // work orders, and null is the honest answer until it has them.
    expect(life.maintenanceToDate).toBeNull();
  });

  it("says nothing about the life of an asset with no dates on it", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where name_el = 'Ακτινολογικό συγκρότημα εξωτερικών ιατρείων'",
    );
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get(`/assets/${rows[0].id}`)
      .set(bearer(token));
    expect(response.body.status).toBe("PLANNED");
    expect(response.body.wholeLife.ageYears).toBeNull();
    expect(response.body.wholeLife.remainingLifeYears).toBeNull();
  });
});
