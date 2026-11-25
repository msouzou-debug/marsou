import type { INestApplication } from "@nestjs/common";
import { MaintenanceAgreementList, type MaintenanceAgreementRow } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayInNicosia } from "../src/maintenance/maintenance-rules";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract, makeSystem, uniq } from "./maintenance-support";

/**
 * S18b's agreements dashboard (owner UAT): `GET /maintenance/agreements`
 * with its five filters — unit, equipment type (the register class of an
 * active catalogue line), contractor, expiry band and free text. The suite
 * makes its own two agreements under one unique token and narrows every
 * call to it with `q`, so no other suite's rows change what it counts.
 */
describe("maintenance: the agreements dashboard", () => {
  let app: INestApplication;
  let token: string;
  let expiring: MaintenanceAgreementRow;
  let expired: MaintenanceAgreementRow;
  const tag = uniq("DASH");
  const today = todayInNicosia(new Date());

  const http = () => request(app.getHttpServer());

  async function list(query: string, email: string = USERS.estatesNicosia): Promise<MaintenanceAgreementList> {
    const caller = email === USERS.estatesNicosia ? token : await tokenFor(app, email);
    const response = await http().get(`/maintenance/agreements?${query}`).set(bearer(caller));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return MaintenanceAgreementList.parse(response.body);
  }
  const refs = (body: MaintenanceAgreementList) => body.items.map((row) => row.ref).sort();

  beforeAll(async () => {
    app = await createTestApp();
    token = await tokenFor(app, USERS.estatesNicosia);
    const contractors = await http().get("/contractors").set(bearer(token));
    const usable = ((contractors.body.items ?? contractors.body) as { id: string; blacklisted: boolean }[]).filter((c) => !c.blacklisted);
    expect(usable.length).toBeGreaterThanOrEqual(2);

    // 30 days to run, an HVAC line and a line with no register class.
    const a = await makeContract(app, USERS.estatesNicosia, {
      ref: `${tag}-A`,
      contractorId: usable[0].id,
      startDate: "2025-01-01",
      endDate: addDays(today, 30),
      contractValue: 120000,
    });
    await makeSystem(app, a.id, { assetClass: "HVAC" });
    await makeSystem(app, a.id, { assetClass: null, permitSystem: "DRAINAGE" });
    // Ten days past its end, a FIRE line, another contractor.
    const b = await makeContract(app, USERS.estatesNicosia, {
      ref: `${tag}-B`,
      contractorId: usable[1].id,
      startDate: "2024-01-01",
      endDate: addDays(today, -10),
    });
    await makeSystem(app, b.id, { assetClass: "FIRE" });

    const both = await list(`q=${encodeURIComponent(tag)}`);
    expiring = both.items.find((row) => row.id === a.id)!;
    expired = both.items.find((row) => row.id === b.id)!;
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists every agreement with its expiry, cover and counts, the nearest end first", async () => {
    const body = await list(`q=${encodeURIComponent(tag)}`);
    expect(body.today).toBe(today);
    expect(body.items.map((row) => row.ref)).toEqual([`${tag}-B`, `${tag}-A`]);
    expect(expiring).toMatchObject({
      orgUnitId: "nicosia-general",
      status: "ACTIVE",
      daysToExpiry: 30,
      expiryBand: "EXPIRING",
      contractValue: 120000,
      assetClasses: ["HVAC"],
      systemsCount: 2,
      pmSchedulesCount: 0,
      pmDueThisMonth: 0,
      pmOverdue: 0,
    });
    // Nicosia's register has HVAC assets; the drainage line adds none.
    expect(expiring.assetsCount).toBeGreaterThan(0);
    expect(expired).toMatchObject({ daysToExpiry: -10, expiryBand: "EXPIRED", assetClasses: ["FIRE"], contractValue: null });
    // The contractor options are every visible agreement's, filters aside.
    expect(body.contractors.map((c) => c.id)).toEqual(expect.arrayContaining([expiring.contractorId, expired.contractorId]));
  });

  it("filters by equipment type, expiry band, contractor and unit, each repeatable", async () => {
    const q = `q=${encodeURIComponent(tag)}`;
    expect(refs(await list(`${q}&assetClass=HVAC`))).toEqual([`${tag}-A`]);
    expect(refs(await list(`${q}&assetClass=HVAC&assetClass=FIRE`))).toEqual([`${tag}-A`, `${tag}-B`]);
    expect(refs(await list(`${q}&assetClass=LIFT`))).toEqual([]);
    expect(refs(await list(`${q}&band=EXPIRED`))).toEqual([`${tag}-B`]);
    expect(refs(await list(`${q}&band=EXPIRING&band=EXPIRED`))).toEqual([`${tag}-A`, `${tag}-B`]);
    expect(refs(await list(`${q}&band=OK`))).toEqual([]);
    expect(refs(await list(`${q}&contractorId=${expired.contractorId}`))).toEqual([`${tag}-B`]);
    expect(refs(await list(`${q}&contractorId=not-a-uuid`))).toEqual([]);
    expect(refs(await list(`${q}&orgUnitId=nicosia-general&orgUnitId=larnaca-general`))).toEqual([`${tag}-A`, `${tag}-B`]);
    expect(refs(await list(`${q}&orgUnitId=larnaca-general`))).toEqual([]);
  });

  it("finds by reference, title or contractor, case- and accent-insensitive", async () => {
    expect(refs(await list(`q=${encodeURIComponent(`${tag}-a`.toLowerCase())}`))).toEqual([`${tag}-A`]);
    const byTitle = await list(`q=${encodeURIComponent("ΣΥΜΒΑΣΗ ΣΥΝΤΗΡΗΣΗΣ ΔΟΚΙΜΗΣ")}&band=EXPIRED`);
    expect(byTitle.items.map((row) => row.id)).toContain(expired.id);
  });

  it("refuses a band or class that does not exist", async () => {
    const bad = await http().get("/maintenance/agreements?band=SOON").set(bearer(token));
    expect(bad.status).toBe(400);
    const badClass = await http().get("/maintenance/agreements?assetClass=ROCKET").set(bearer(token));
    expect(badClass.status).toBe(400);
  });

  it("keeps to the row policies: Larnaca's engineer sees none of Nicosia's", async () => {
    const theirs = await list(`q=${encodeURIComponent(tag)}`, USERS.engineerLarnaca);
    expect(theirs.items).toEqual([]);
    const all = await list("", USERS.engineerLarnaca);
    expect(all.items.every((row) => row.orgUnitId === "larnaca-general")).toBe(true);
    expect(all.items.map((row) => row.ref)).toContain("Α.Ο 17/25");
  });

  it("shows the five seeded agreements to the administrator, with their programmes", async () => {
    const body = await list(`q=${encodeURIComponent("Α.Ο")}`, USERS.admin);
    const seeded = ["Α.Ο 42/24", "Α.Ο 17/25", "Α.Ο 18/25", "Α.Ο 19/25", "Α.Ο 22/25"];
    for (const ref of seeded) {
      const row = body.items.find((r) => r.ref === ref);
      expect(row, ref).toBeDefined();
      expect(row?.systemsCount, ref).toBeGreaterThan(0);
      expect(row?.assetClasses.length, ref).toBeGreaterThan(0);
    }
    const limassol = body.items.find((r) => r.ref === "Α.Ο 18/25");
    expect(limassol?.pmSchedulesCount).toBeGreaterThanOrEqual(6);
    expect(limassol?.assetsCount).toBeGreaterThan(0);
  });
});
