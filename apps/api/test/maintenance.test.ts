import type { INestApplication } from "@nestjs/common";
import {
  MaintenanceContract,
  MaintenanceSummary,
  PmGenerationResult,
  PmSchedule,
  SlaImportResult,
  SlaSystem,
  addHours,
  nextDueAfter,
} from "@ecapital/shared";
import ExcelJS from "exceljs";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MaintenanceSweepService } from "../src/maintenance/maintenance-sweep.service";
import { addDays, todayInNicosia } from "../src/maintenance/maintenance-rules";
import { SLA_COLUMNS } from "../src/maintenance/sla-import";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { binary, makeAsset, makeContract, makeOrder, makeSystem, uniq } from "./maintenance-support";

/**
 * M5 — the agreement, its SLA catalogue (R32), the preventive programme and
 * the pass that turns it into orders (R32, R33), as the API serves them
 * (ADR-0031). Each test makes its own agreement, so nothing here depends on
 * what another suite left in the database.
 */
describe("maintenance: agreements, catalogue and programme", () => {
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

  const http = () => request(app.getHttpServer());

  // ------------------------------------------------------- the seed --

  it("seeds Nicosia's real agreement: Α.Ο 42/24 and its 48 systems with null rates", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const list = await http().get("/maintenance/contracts?orgUnitId=nicosia-general").set(bearer(token));
    expect(list.status).toBe(200);
    const contract = (list.body as MaintenanceContract[]).find((c) => c.ref === "Α.Ο 42/24");
    expect(contract).toBeDefined();
    expect(contract?.roundTheClock).toBe(true);
    expect(contract?.availabilityHoursYear).toBe(8600);
    expect(contract?.systemsCount).toBe(48);

    const systems = await http()
      .get(`/maintenance/contracts/${contract?.id}/systems`)
      .set(bearer(token));
    expect(systems.status).toBe(200);
    const rows = (systems.body as SlaSystem[]).map((s) => SlaSystem.parse(s));
    expect(rows).toHaveLength(48);
    const first = rows.find((s) => s.code === "1.1.1");
    expect(first).toMatchObject({ band: "CRITICAL", responseHours: 0.5, restoreHours: 2, reportHours: 24 });
    // ADR-0031 §2: the amounts did not survive the copy.
    expect(rows.every((s) => s.penaltyResponsePerHour === null && s.penaltyPmPerDay === null)).toBe(true);
    // The table's own order: 1.2.10 after 1.2.9.
    const codes = rows.map((s) => s.code);
    expect(codes.indexOf("1.2.10")).toBe(codes.indexOf("1.2.9") + 1);
  });

  it("hides another unit's agreement: Larnaca's engineer sees none of Nicosia's", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const list = await http().get("/maintenance/contracts").set(bearer(token));
    expect(list.status).toBe(200);
    expect((list.body as MaintenanceContract[]).every((c) => c.orgUnitId === "larnaca-general")).toBe(true);
    const ngh = await makeContract(app);
    const one = await http().get(`/maintenance/contracts/${ngh.id}`).set(bearer(token));
    expect(one.status).toBe(404);
  });

  // ------------------------------------------------------- the agreement --

  it("records an agreement with the contract's defaults and refuses a duplicate reference", async () => {
    const contract = await makeContract(app);
    expect(contract).toMatchObject({
      orgUnitId: "nicosia-general",
      roundTheClock: true,
      normalHoursFrom: "07:30",
      normalHoursTo: "15:00",
      availabilityPenaltyCriticalPerHour: 5,
      availabilityPenaltyOtherPerHour: 1,
      penaltyCapPct: 10,
      status: "ACTIVE",
      systemsCount: 0,
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const again = await http()
      .post("/maintenance/contracts")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        contractorId: contract.contractorId,
        ref: contract.ref,
        titleEl: "Δεύτερη",
        startDate: "2026-01-01",
      });
    expect(again.status).toBe(409);
    expect(again.body.key).toBe("errors.maintenanceContractRefTaken");
  });

  it("changes what a PATCH names and refuses to move the agreement to another unit", async () => {
    const contract = await makeContract(app);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const changed = await http()
      .patch(`/maintenance/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ contractValue: 1200000, normalHoursTo: "15:30" });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ contractValue: 1200000, normalHoursTo: "15:30", titleEl: contract.titleEl });

    const moved = await http()
      .patch(`/maintenance/contracts/${contract.id}`)
      .set(bearer(token))
      .send({ orgUnitId: "larnaca-general" });
    expect(moved.status).toBe(422);
    expect(moved.body.key).toBe("errors.maintenanceContractUnitFixed");
  });

  it("lets a technician raise and work orders but not keep an agreement (403)", async () => {
    const technician = await tokenFor(app, USERS.technicianNicosia);
    const contract = await makeContract(app);
    const create = await http()
      .post("/maintenance/contracts")
      .set(bearer(technician))
      .send({
        orgUnitId: "nicosia-general",
        contractorId: contract.contractorId,
        ref: uniq("Α.Ο"),
        titleEl: "Σύμβαση τεχνίτη",
        startDate: "2026-01-01",
      });
    expect(create.status).toBe(403);
    const patch = await http()
      .patch(`/maintenance/contracts/${contract.id}`)
      .set(bearer(technician))
      .send({ titleEl: "Αλλαγή τεχνίτη" });
    expect(patch.status).toBe(403);
    // …and reads it, like everybody in the unit.
    const read = await http().get(`/maintenance/contracts/${contract.id}`).set(bearer(technician));
    expect(read.status).toBe(200);
  });

  it("lets the auditor read everything and write nothing", async () => {
    const auditor = await tokenFor(app, USERS.auditor);
    const contract = await makeContract(app);
    expect((await http().get(`/maintenance/contracts/${contract.id}`).set(bearer(auditor))).status).toBe(200);
    expect(
      (await http().get(`/maintenance/contracts/${contract.id}/systems`).set(bearer(auditor))).status,
    ).toBe(200);
    const write = await http()
      .post(`/maintenance/contracts/${contract.id}/systems`)
      .set(bearer(auditor))
      .send({ code: "9.9", nameEl: "Δοκιμή", band: "P1", responseHours: 1, restoreHours: 2, reportHours: 3 });
    expect(write.status).toBe(403);
    expect((await http().post("/maintenance/schedules/generate").set(bearer(auditor))).status).toBe(403);
  });

  // ------------------------------------------------------- the catalogue --

  it("adds a line, refuses a duplicate code and lets a missing rate be typed in later", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id, { code: "1.1.1", band: "CRITICAL", restoreHours: 2, reportHours: 24 });
    expect(system).toMatchObject({ orgUnitId: "nicosia-general", penaltyRestorePerHour: null, active: true });

    const token = await tokenFor(app, USERS.estatesNicosia);
    const duplicate = await http()
      .post(`/maintenance/contracts/${contract.id}/systems`)
      .set(bearer(token))
      .send({ code: "1.1.1", nameEl: "Άλλο", band: "P1", responseHours: 1, restoreHours: 2, reportHours: 3 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.key).toBe("errors.slaSystemCodeTaken");

    const rated = await http()
      .patch(`/maintenance/systems/${system.id}`)
      .set(bearer(token))
      .send({ penaltyRestorePerHour: 25 });
    expect(rated.status).toBe(200);
    expect(rated.body).toMatchObject({ penaltyRestorePerHour: 25, band: "CRITICAL", code: "1.1.1" });
  });

  it("imports the contract's table: creates, updates by code, skips the unchanged and reports bad rows", async () => {
    const contract = await makeContract(app);
    await makeSystem(app, contract.id, { code: "1.2.1", nameEl: "Σύστημα Κλιματισμού", band: "P1" });
    await makeSystem(app, contract.id, {
      code: "1.2.2",
      nameEl: "Σύστημα Εξαερισμού",
      band: "P1",
      responseHours: 0.5,
      restoreHours: 24,
      reportHours: 48,
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Κατάλογος");
    sheet.addRow(SLA_COLUMNS.map((c) => c.header));
    sheet.addRow(["1.1.1", "Κλιματισμός χειρουργείων", "Κρίσιμο", 0.5, 2, 24, "Τριμηνιαία", null, 10, 20]);
    sheet.addRow(["1.2.1", "Σύστημα Κλιματισμού", "Προτεραιότητα 1", 0.5, 12, 48, "Μηνιαία, Εξαμηνιαία"]);
    sheet.addRow(["1.2.2", "Σύστημα Εξαερισμού", "P1", 0.5, 24, 48]);
    sheet.addRow(["1.2.3", "Ιατρικά αέρια", "Επείγον", 0.5, 24, 48]);
    sheet.addRow(["1.2.4", "Πυρόσβεση", "P1", "δύο", 24, 48]);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .post(`/maintenance/contracts/${contract.id}/systems/import`)
      .set(bearer(token))
      .attach("file", file, { filename: "sla.xlsx" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const result = SlaImportResult.parse(response.body);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.errors.map((e) => e.row)).toEqual([5, 6]);

    const systems = (await http().get(`/maintenance/contracts/${contract.id}/systems`).set(bearer(token)))
      .body as SlaSystem[];
    expect(systems.map((s) => s.code)).toEqual(["1.1.1", "1.2.1", "1.2.2"]);
    expect(systems.find((s) => s.code === "1.2.1")).toMatchObject({
      restoreHours: 12,
      pmFrequencies: ["MONTHLY", "SEMIANNUAL"],
    });
    expect(systems.find((s) => s.code === "1.1.1")).toMatchObject({
      band: "CRITICAL",
      penaltyResponsePerHour: 10,
      penaltyRestorePerHour: 20,
      penaltyPmPerDay: null,
    });
  });

  it("refuses an upload that is not a workbook (400) and an upload with no file (400)", async () => {
    const contract = await makeContract(app);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const garbage = await http()
      .post(`/maintenance/contracts/${contract.id}/systems/import`)
      .set(bearer(token))
      .attach("file", Buffer.from("not a workbook"), { filename: "sla.xlsx" });
    expect(garbage.status).toBe(400);
    expect(garbage.body.key).toBe("errors.slaImportFileNotValid");
    const none = await http()
      .post(`/maintenance/contracts/${contract.id}/systems/import`)
      .set(bearer(token))
      .field("note", "x");
    expect(none.status).toBe(400);
  });

  it("hands out the catalogue as the import template, which imports back unchanged", async () => {
    const contract = await makeContract(app);
    await makeSystem(app, contract.id, { code: "2.2.5", nameEl: "Ηλεκτροπαραγωγά Ζεύγη", pmFrequencies: ["MONTHLY"], penaltyPmPerDay: 40 });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const template = await http()
      .get(`/maintenance/contracts/${contract.id}/systems/template.xlsx`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(template.status).toBe(200);
    expect(template.headers["content-type"]).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(template.body);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("A1").value).toBe("Κωδικός");
    expect(sheet.getCell("A2").value).toBe("2.2.5");
    expect(sheet.getCell("G2").value).toBe("Μηνιαία");

    const back = await http()
      .post(`/maintenance/contracts/${contract.id}/systems/import`)
      .set(bearer(token))
      .attach("file", template.body, { filename: "back.xlsx" });
    expect(back.status).toBe(201);
    expect(back.body).toEqual({ created: 0, updated: 0, skipped: 1, errors: [] });
  });

  // ------------------------------------------------------- the programme --

  it("adds a programme line under the system's agreement and lists it with no open order", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id);
    const asset = await makeAsset(app);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({
        slaSystemId: system.id,
        assetId: asset.id,
        titleEl: "Μηνιαία συντήρηση δοκιμής",
        frequency: "MONTHLY",
        nextDue: addDays(todayInNicosia(new Date()), 40),
        checklistEl: "Έλεγχος φίλτρων",
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const schedule = PmSchedule.parse(created.body);
    expect(schedule).toMatchObject({
      maintenanceContractId: contract.id,
      slaSystemCode: system.code,
      assetTag: asset.tag,
      leadDays: 14,
      openWorkOrderId: null,
    });

    const list = await http()
      .get(`/maintenance/schedules?maintenanceContractId=${contract.id}&active=true`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect((list.body as PmSchedule[]).map((s) => s.id)).toEqual([schedule.id]);

    const patched = await http()
      .patch(`/maintenance/schedules/${schedule.id}`)
      .set(bearer(token))
      .send({ leadDays: 7, active: false });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ leadDays: 7, active: false, titleEl: schedule.titleEl });
  });

  it("refuses a programme line on another unit's asset (404)", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id);
    const larnaca = await makeAsset(app, { orgUnitId: "larnaca-general" }, USERS.admin);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({
        slaSystemId: system.id,
        assetId: larnaca.id,
        titleEl: "Λάθος μονάδα",
        frequency: "MONTHLY",
        nextDue: "2026-12-01",
      });
    expect(response.status).toBe(404);
  });

  it("issues one PM order inside the lead time, moves the date on, and never doubles on a re-run", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id, { band: "P2" });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const nextDue = addDays(todayInNicosia(new Date()), 3);
    const created = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({ slaSystemId: system.id, titleEl: `Εβδομαδιαίος έλεγχος ${uniq()}`, frequency: "WEEKLY", nextDue });
    const schedule = PmSchedule.parse(created.body);

    const first = await http().post("/maintenance/schedules/generate").set(bearer(token));
    expect(first.status).toBe(200);
    expect(PmGenerationResult.parse(first.body).generated).toBeGreaterThanOrEqual(1);

    const after = (
      (await http().get(`/maintenance/schedules?maintenanceContractId=${contract.id}`).set(bearer(token)))
        .body as PmSchedule[]
    )[0];
    expect(after.nextDue).toBe(nextDueAfter(nextDue, "WEEKLY"));
    expect(after.lastGeneratedAt).not.toBeNull();
    expect(after.openWorkOrderId).not.toBeNull();

    const order = await http().get(`/work-orders/${after.openWorkOrderId}`).set(bearer(token));
    expect(order.status).toBe(200);
    expect(order.body).toMatchObject({
      kind: "PM",
      source: "PM_PROGRAMME",
      status: "OPEN",
      dueDate: nextDue,
      pmScheduleId: schedule.id,
      band: "P2",
      raisedByName: "Ανδρέας Παπαδόπουλος",
      dueResponseAt: null,
    });
    expect(order.body.ref).toMatch(/^NGH-WO-\d{4}-\d{4}$/);
    expect(order.body.sla.response).toBeNull();
    // 23:59 Nicosia on the programme date; the report a week later.
    expect(new Date(order.body.dueReportAt).getTime() - new Date(order.body.dueRestoreAt).getTime()).toBeGreaterThanOrEqual(7 * 86_400_000 - 3_600_000);

    // The next date (a week on) is still inside the lead time, so the line
    // is due again — and is skipped, because its order is still open.
    const second = await http().post("/maintenance/schedules/generate").set(bearer(token));
    const result = PmGenerationResult.parse(second.body);
    expect(result.skippedOpen).toBeGreaterThanOrEqual(1);
    const { rows } = await admin.query(
      "select count(*)::int as n from ecapital.work_order where pm_schedule_id = $1",
      [schedule.id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("does not issue a line outside its lead time, or an inactive one", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const far = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({ slaSystemId: system.id, titleEl: "Μακρινή", frequency: "ANNUAL", nextDue: addDays(todayInNicosia(new Date()), 60) });
    const off = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({ slaSystemId: system.id, titleEl: "Ανενεργή", frequency: "ANNUAL", nextDue: addDays(todayInNicosia(new Date()), -1), active: false });
    await http().post("/maintenance/schedules/generate").set(bearer(token));
    for (const id of [far.body.id, off.body.id]) {
      const { rows } = await admin.query(
        "select count(*)::int as n from ecapital.work_order where pm_schedule_id = $1",
        [id],
      );
      expect(rows[0].n).toBe(0);
    }
  });

  it("escalates an unanswered call once: one stamp, one ESCALATED line, however many passes", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id, { band: "CRITICAL", responseHours: 0.5, restoreHours: 2, reportHours: 24 });
    const calledAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const order = await makeOrder(app, { slaSystemId: system.id, calledAt });
    expect(order.dueResponseAt).toBe(addHours(calledAt, 0.5));
    expect(order.sla.response).toBe("RED");

    const token = await tokenFor(app, USERS.estatesNicosia);
    const first = await http().post("/maintenance/schedules/generate").set(bearer(token));
    expect(first.body.escalated).toBeGreaterThanOrEqual(1);
    const stamped = (await http().get(`/work-orders/${order.id}`).set(bearer(token))).body;
    expect(stamped.escalatedAt).not.toBeNull();

    await http().post("/maintenance/schedules/generate").set(bearer(token));
    // The hourly sweep runs the same pass as `scheduler:maintenance`.
    await app.get(MaintenanceSweepService).sweep(new Date());
    const again = (await http().get(`/work-orders/${order.id}`).set(bearer(token))).body;
    expect(again.escalatedAt).toBe(stamped.escalatedAt);
    expect(again.events.filter((e: { kind: string }) => e.kind === "ESCALATED")).toHaveLength(1);
  });

  it("the hourly sweep issues orders as «Σύστημα» and the audit trail names the scheduler", async () => {
    const contract = await makeContract(app);
    const system = await makeSystem(app, contract.id);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await http()
      .post("/maintenance/schedules")
      .set(bearer(token))
      .send({ slaSystemId: system.id, titleEl: `Ετήσιος έλεγχος ${uniq()}`, frequency: "ANNUAL", nextDue: addDays(todayInNicosia(new Date()), 1) });
    const result = await app.get(MaintenanceSweepService).sweep(new Date());
    expect(result.generated).toBeGreaterThanOrEqual(1);

    const schedule = (
      (await http().get(`/maintenance/schedules?maintenanceContractId=${contract.id}`).set(bearer(token)))
        .body as PmSchedule[]
    ).find((s) => s.id === created.body.id);
    const order = (await http().get(`/work-orders/${schedule?.openWorkOrderId}`).set(bearer(token))).body;
    expect(order.raisedById).toBeNull();
    expect(order.raisedByName).toBe("Σύστημα");
    const { rows } = await admin.query(
      "select actor_id from ecapital.audit_log where entity_type = 'work_order' and entity_id = $1 and action = 'INSERT'",
      [order.id],
    );
    expect(rows.map((r) => r.actor_id)).toEqual(["scheduler:maintenance"]);
  });

  // ------------------------------------------------------- the tiles --

  it("answers the summary tiles for the caller's units and for one unit", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const all = await http().get("/maintenance/summary").set(bearer(token));
    expect(all.status).toBe(200);
    const tiles = MaintenanceSummary.parse(all.body);
    // The seed has an escalated generator call and an open backlog.
    expect(tiles.overdueResponse).toBeGreaterThanOrEqual(1);
    expect(tiles.backlogUnfundedEur).toBeGreaterThan(0);

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const theirs = MaintenanceSummary.parse(
      (await http().get("/maintenance/summary?orgUnitId=larnaca-general").set(bearer(larnaca))).body,
    );
    expect(theirs.open).toBeGreaterThanOrEqual(1);
    // A unit the caller cannot read is an empty unit, not somebody else's figures.
    const none = MaintenanceSummary.parse(
      (await http().get("/maintenance/summary?orgUnitId=nicosia-general").set(bearer(larnaca))).body,
    );
    expect(none).toEqual({
      open: 0,
      overdueResponse: 0,
      overdueRestore: 0,
      pmDueThisMonth: 0,
      pmOverdue: 0,
      backlogUnfundedEur: 0,
    });
  });
});
