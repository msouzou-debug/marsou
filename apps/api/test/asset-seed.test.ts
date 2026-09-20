import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../src/db/seed";

/**
 * The seeded asset register (CAPEX-01 §15). What a developer opens the app
 * on, and what every other M4 suite leans on.
 *
 * The one rule worth a test of its own: a second run updates in place and
 * does not relabel the estate. A tag is on a sticker on a machine.
 */
describe("the seeded asset register", () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
  });

  it("covers Nicosia and Larnaca with the plant the brief names", async () => {
    const { rows } = await admin.query<{ org_unit_id: string; n: string }>(
      `select org_unit_id, count(*)::text as n from ecapital.asset
        where sap_asset_no like 'ANG-%' or sap_asset_no like 'ALA-%'
           or name_el like 'Στεγάνωση%' or name_el like 'Ακτινολογικό%'
        group by org_unit_id order by org_unit_id`,
    );
    const byUnit = new Map(rows.map((r) => [r.org_unit_id, Number(r.n)]));
    expect(byUnit.get("nicosia-general")).toBeGreaterThanOrEqual(15);
    expect(byUnit.get("larnaca-general")).toBeGreaterThanOrEqual(7);

    const classes = await admin.query<{ asset_class: string }>(
      `select distinct asset_class from ecapital.asset
        where org_unit_id in ('nicosia-general', 'larnaca-general') order by asset_class`,
    );
    for (const wanted of [
      "BUILDING_FABRIC",
      "BIOMEDICAL",
      "ELECTRICAL",
      "FIRE",
      "HVAC",
      "IT",
      "LIFT",
      "MEDICAL_GAS",
      "WATER",
    ]) {
      expect(classes.rows.map((r) => r.asset_class), wanted).toContain(wanted);
    }
  });

  it("hangs the fans under their air-handling units", async () => {
    const { rows } = await admin.query<{ child: string; parent: string }>(
      `select c.name_el as child, p.name_el as parent
         from ecapital.asset c join ecapital.asset p on p.id = c.parent_asset_id
        order by c.name_el`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r) => r.parent.includes("ΚΚΜ"))).toBe(true);
  });

  it("keeps the disposed chiller in the register", async () => {
    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from ecapital.asset where status = 'DISPOSED' and name_el like 'Ψύκτης%'",
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("spreads the replacement years over 2027 to 2035", async () => {
    const { rows } = await admin.query<{ year: number }>(
      `select distinct replacement_year as year from ecapital.asset
        where replacement_year between 2027 and 2035
          and org_unit_id in ('nicosia-general', 'larnaca-general')
        order by 1`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows[0].year).toBe(2027);
  });

  it("files the manifold's two papers with their eArchive protocol numbers", async () => {
    const { rows } = await admin.query<{ protocol_number: string; status: string }>(
      `select d.protocol_number, o.status
         from ecapital.asset a
         join ecapital.asset_document ad on ad.asset_id = a.id
         join ecapital.document d on d.id = ad.document_id
         join ecapital.dms_outbox o on o.document_id = d.id
        where a.name_el = 'Συστοιχία ιατρικών αερίων Α'
        order by d.protocol_number`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
    expect(rows.every((r) => r.protocol_number.startsWith("ΤΥ/2020/"))).toBe(true);
  });

  it("carries no patient data anywhere in the register", async () => {
    // R45 puts a ventilator and an anaesthesia machine in the same register
    // as the chillers. CAPEX-01 §12 says nothing about a patient may enter
    // this system, so the two biomedical rows carry a make, a model, a serial
    // number and a room, and nothing that could name anybody.
    const { rows } = await admin.query<{ name_el: string; serial_no: string }>(
      "select name_el, serial_no from ecapital.asset where asset_class = 'BIOMEDICAL'",
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // A bed number is a room fact; nothing here is a person.
    expect(rows.every((r) => !/ασθεν|patient/i.test(r.name_el))).toBe(true);
  });

  it("re-runs without duplicating a row or reissuing a tag", async () => {
    const before = await admin.query<{ id: string; tag: string }>(
      "select id, tag from ecapital.asset order by tag",
    );
    await seed(process.env.MIGRATION_DATABASE_URL as string);
    const after = await admin.query<{ id: string; tag: string }>(
      "select id, tag from ecapital.asset order by tag",
    );
    expect(after.rows).toEqual(before.rows);

    const links = await admin.query<{ n: string }>(
      "select count(*)::text as n from ecapital.asset_document",
    );
    expect(Number(links.rows[0].n)).toBe(2);
  }, 180_000);
});
