import type { INestApplication } from "@nestjs/common";
import { Scorecard } from "@ecapital/shared";
import ExcelJS from "exceljs";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { SCORE_EXPECTED, SCORE_FROM, SCORE_ORDERS, SCORE_TO } from "./maintenance-fixture";
import { binary, makeAsset, makeContract, makeSystem } from "./maintenance-support";

/**
 * R37 — Αξιολόγηση αναδόχων through the API (ADR-0031 §9). The orders of the
 * hand-worked fixture (test/maintenance-fixture.ts) are written straight
 * into the database under an agreement this suite owns, because March 2026
 * is in the past and a PM order is the sweep's to issue; the scorecard then
 * has to give back exactly the figures worked out by hand.
 */
describe("contractor scorecard", () => {
  let app: INestApplication;
  let admin: Client;
  let contractId: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();

    const contract = await makeContract(app, USERS.estatesNicosia, { contractValue: 100000 });
    contractId = contract.id;
    const s1 = await makeSystem(app, contract.id, {
      code: "1.1.1",
      band: "CRITICAL",
      responseHours: 0.5,
      restoreHours: 2,
      reportHours: 24,
      penaltyPmPerDay: 50,
      penaltyResponsePerHour: 10,
      penaltyRestorePerHour: 20,
    });
    const s2 = await makeSystem(app, contract.id, { code: "1.2.1", band: "P1" });
    const assets = { A: (await makeAsset(app)).id, B: (await makeAsset(app)).id };

    for (const order of SCORE_ORDERS) {
      const system = order.slaSystemCode === "1.1.1" ? s1 : s2;
      const coded = order.kind === "CORRECTIVE" && order.status === "COMPLETED";
      await admin.query(
        `insert into ecapital.work_order (
           ref, org_unit_id, kind, status, source, maintenance_contract_id, sla_system_id, band,
           asset_id, title_el, called_at, due_response_at, due_restore_base_at, due_restore_at,
           due_report_at, due_date, responded_at, restored_at, completed_at, report_received_at,
           cancelled_at, failure_code, cause_code, remedy_code)
         values (ecapital.allocate_work_order_ref('nicosia-general', 2026), 'nicosia-general',
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11, $12, $13, $14, $15, $16, $17,
           $18, $19, $20, $21)`,
        [
          order.kind,
          order.status,
          order.kind === "PM" ? "PM_PROGRAMME" : "VENDOR_ONSITE",
          contract.id,
          system.id,
          order.band,
          order.assetId ? assets[order.assetId as "A" | "B"] : null,
          `Εντολή αξιολόγησης ${order.ref}`,
          order.calledAt,
          order.dueResponseAt,
          order.dueRestoreAt,
          order.dueReportAt,
          order.dueDate,
          order.respondedAt,
          order.restoredAt,
          order.completedAt,
          order.reportReceivedAt,
          order.status === "CANCELLED" ? order.calledAt : null,
          coded ? "LEAK" : null,
          coded ? "WEAR" : null,
          coded ? "REPAIR" : null,
        ],
      );
    }
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const query = () => `maintenanceContractId=${contractId}&from=${SCORE_FROM}&to=${SCORE_TO}`;

  it("gives the hand-worked figures for the March fixture", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http().get(`/maintenance/scorecard?${query()}`).set(bearer(token));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const card = Scorecard.parse(response.body);
    expect(card).toMatchObject(SCORE_EXPECTED);
    expect(card).toMatchObject({ maintenanceContractId: contractId, from: SCORE_FROM, to: SCORE_TO });
  });

  it("is read by the auditor and hidden from another unit (404)", async () => {
    const auditor = await tokenFor(app, USERS.auditor);
    expect((await http().get(`/maintenance/scorecard?${query()}`).set(bearer(auditor))).status).toBe(200);
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    expect((await http().get(`/maintenance/scorecard?${query()}`).set(bearer(larnaca))).status).toBe(404);
  });

  it("refuses a period the wrong way round (400)", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .get(`/maintenance/scorecard?maintenanceContractId=${contractId}&from=${SCORE_TO}&to=${SCORE_FROM}`)
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.scorecardQueryNotValid");
  });

  it("exports «Εντολές» and «Αξιολόγηση» with every ratio, penalty and total a live formula", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .get(`/maintenance/scorecard.xlsx?${query()}`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    expect(response.headers["content-disposition"]).toContain(".xlsx");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Εντολές", "Αξιολόγηση"]);

    const orders = workbook.getWorksheet("Εντολές") as ExcelJS.Worksheet;
    // Two header rows, then every order the period touches: called in March
    // (the cancelled O6 included, flagged out by its own formula) or a PM
    // visit due in March. O7, called in February, is not one of them.
    const touched = SCORE_ORDERS.filter((o) => o.ref !== "O7");
    expect(orders.rowCount).toBe(2 + touched.length);
    const refs: unknown[] = [];
    orders.getColumn(1).eachCell((cell, rowNo) => {
      if (rowNo > 2) refs.push(cell.value);
    });
    expect(refs.length).toBe(touched.length);
    const late = orders.getCell("J3").value as { formula?: string };
    expect(late.formula).toContain("*24");

    const card = workbook.getWorksheet("Αξιολόγηση") as ExcelJS.Worksheet;
    expect(card.getCell("B6").value).toBe(8600);
    expect(card.getCell("B9").value).toBe(100000);
    const labels = new Map<string, ExcelJS.Cell>();
    card.eachRow((row) => labels.set(String(row.getCell(1).value), row.getCell(2)));
    for (const label of [
      "Ανταπόκριση",
      "Προληπτική συντήρηση",
      "Ρήτρα διαθεσιμότητας (€)",
      "Σύνολο ρητρών (€)",
      "Ποσοστό επί της αξίας σύμβασης (%)",
      "Πάγια με επαναλαμβανόμενες βλάβες",
    ]) {
      const cell = labels.get(label);
      expect((cell?.value as { formula?: string } | null)?.formula, label).toBeTruthy();
    }
  });
});
