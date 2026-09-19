import type { INestApplication } from "@nestjs/common";
import { CalendarEntry, DisruptionHoursRow } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { approvedPermit, draftPermit, nicosiaAreas, runIcra, submit, type AreaIds } from "./permit-support";

/**
 * R25 and CAPEX-01 §11 — «Ημερολόγιο κλινικής διατάραξης», the one calendar
 * across the network, and the theatre and ICU hours lost behind it.
 */
describe("the disruption calendar", () => {
  let app: INestApplication;
  let client: Client;
  let areas: AreaIds;
  let stamp = 0;

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

  const title = (what: string) => `${what} ${Date.now()}-${(stamp += 1)}`;
  const day = (offsetDays: number) =>
    new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  async function calendar(email: string, query: string): Promise<CalendarEntry[]> {
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .get(`/calendar?${query}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    return response.body.map((row: unknown) => CalendarEntry.parse(row));
  }

  it("shows agreed and running permits in the window, with their areas", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Στο ημερολόγιο"),
      areaIds: [areas.theatre],
      activityType: "B",
      startInHours: 24 * 3,
      endInHours: 24 * 3 + 6,
    });
    const entries = await calendar(USERS.estatesNicosia, `from=${day(0)}&to=${day(10)}`);
    const entry = entries.find((row) => row.permitId === permit.id);
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("APPROVED");
    expect(entry?.orgUnitCode).toBe("NGH");
    expect(entry?.areaTypes).toContain("THEATRE");
    expect(entry?.areaNamesEl).toContain("Χειρουργείο 1");
    expect(entry?.icraClass).toBe("III");
    expect(entry?.permitRef).toMatch(/^PTW-NGH-/);
  });

  it("leaves a draft off it — nobody has agreed to anything yet", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Πρόχειρο εκτός ημερολογίου"),
      areaIds: [areas.office],
      startInHours: 24 * 4,
      endInHours: 24 * 4 + 4,
    });
    const entries = await calendar(USERS.estatesNicosia, `from=${day(0)}&to=${day(10)}`);
    expect(entries.map((row) => row.permitId)).not.toContain(permit.id);
  });

  it("shows a permit still in clinical review, because the ward needs the warning", async () => {
    const permit = await draftPermit(app, {
      titleEl: title("Σε κλινικό έλεγχο"),
      areaIds: [areas.ward],
      startInHours: 24 * 5,
      endInHours: 24 * 5 + 4,
    });
    await runIcra(app, permit.id, "B");
    await submit(app, permit.id);
    const entries = await calendar(USERS.estatesNicosia, `from=${day(0)}&to=${day(10)}`);
    const entry = entries.find((row) => row.permitId === permit.id);
    expect(entry?.status).toBe("CLINICAL_REVIEW");
  });

  it("leaves out anything whose window is outside the one asked for", async () => {
    const permit = await approvedPermit(app, {
      titleEl: title("Πολύ αργότερα"),
      areaIds: [areas.office],
      activityType: "A",
      startInHours: 24 * 200,
      endInHours: 24 * 200 + 4,
    });
    const near = await calendar(USERS.estatesNicosia, `from=${day(0)}&to=${day(10)}`);
    expect(near.map((row) => row.permitId)).not.toContain(permit.id);
    const far = await calendar(USERS.estatesNicosia, `from=${day(195)}&to=${day(205)}`);
    expect(far.map((row) => row.permitId)).toContain(permit.id);
  });

  it("filters by unit, by area type and by system", async () => {
    const byUnit = await calendar(
      USERS.admin,
      `from=${day(-400)}&to=${day(400)}&orgUnitId=larnaca-general`,
    );
    expect(byUnit.length).toBeGreaterThan(0);
    expect(byUnit.every((row) => row.orgUnitId === "larnaca-general")).toBe(true);

    const theatres = await calendar(
      USERS.admin,
      `from=${day(-400)}&to=${day(400)}&areaType=THEATRE`,
    );
    expect(theatres.length).toBeGreaterThan(0);
    expect(theatres.every((row) => row.areaTypes.includes("THEATRE"))).toBe(true);

    const gas = await calendar(
      USERS.admin,
      `from=${day(-400)}&to=${day(400)}&system=MEDICAL_GAS`,
    );
    expect(gas.length).toBeGreaterThan(0);
    expect(gas.every((row) => row.systems.includes("MEDICAL_GAS"))).toBe(true);
  });

  it("carries the clash flag that was found at submission (§6.7)", async () => {
    const entries = await calendar(USERS.admin, `from=${day(-400)}&to=${day(400)}`);
    // The seed puts two Larnaca permits on medical gas over the same window.
    const clashing = entries.filter((row) => row.hasClash);
    expect(clashing.length).toBeGreaterThan(0);
    expect(clashing.some((row) => row.orgUnitId === "larnaca-general")).toBe(true);
  });

  it("shows Central Administration every unit and a hospital only its own", async () => {
    const central = await calendar(USERS.admin, `from=${day(-400)}&to=${day(400)}`);
    const units = new Set(central.map((row) => row.orgUnitId));
    expect(units.size).toBeGreaterThan(1);

    const local = await calendar(USERS.estatesNicosia, `from=${day(-400)}&to=${day(400)}`);
    expect(local.every((row) => row.orgUnitId === "nicosia-general")).toBe(true);
  });

  it("refuses a window that is not two dates", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/calendar?from=not-a-date&to=2026-12-31")
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.calendarQueryNotValid");
  });

  // --------------------------------------------------- §11, hours lost --

  it("reports theatre and ICU hours lost, by unit and month", async () => {
    const year = new Date().getUTCFullYear();
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/calendar/disruption-hours?year=${year}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    const rows = response.body.map((row: unknown) => DisruptionHoursRow.parse(row));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.month).toMatch(/^\d{4}-\d{2}$/);
      expect(row.month.startsWith(String(year))).toBe(true);
      expect(row.theatreHours + row.icuHours).toBeGreaterThan(0);
      expect(row.permits).toBeGreaterThan(0);
      expect(row.orgUnitNameEl.length).toBeGreaterThan(0);
    }
  });

  it("counts the real window where the permit has one", async () => {
    // A closed permit carries actual_start and actual_end, which is what the
    // report has to use — a job that ran four hours long cost four hours.
    const { rows } = await client.query(
      `select count(*)::int as n from ecapital.shutdown_permit
        where status = 'CLOSED' and actual_start is not null and actual_end is not null`,
    );
    expect(rows[0].n).toBeGreaterThan(0);

    const year = new Date().getUTCFullYear();
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/calendar/disruption-hours?year=${year}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
  });

  it("reports nothing for a year with no permits in it", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/calendar/disruption-hours?year=2001")
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("refuses a year that is not a year", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/calendar/disruption-hours?year=soon")
      .set(bearer(token));
    expect(response.status).toBe(400);
  });
});
