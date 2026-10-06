import type { INestApplication } from "@nestjs/common";
import {
  BacklogItem,
  WorkOrder,
  WorkOrderDetail,
  WorkOrderEvent,
  WorkOrderListRow,
  addHours,
} from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addWorkingDays } from "../src/maintenance/maintenance-rules";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import {
  CODES,
  makeAsset,
  makeContract,
  makeOrder,
  makeSystem,
  step,
  uniq,
} from "./maintenance-support";

/**
 * M5 — Εντολές εργασίας (R33, R34, R36; ADR-0031 §3–8): the call and its
 * three clocks, the steps in order, the coding, the extension, the story,
 * the papers, the backlog rule and who may do which of it.
 */
describe("work orders", () => {
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

  async function setup(band: "CRITICAL" | "P1" | "P2" = "P1") {
    const contract = await makeContract(app);
    const hours =
      band === "CRITICAL"
        ? { responseHours: 0.5, restoreHours: 2, reportHours: 24 }
        : { responseHours: 0.5, restoreHours: 24, reportHours: 48 };
    const system = await makeSystem(app, contract.id, { band, ...hours });
    return { contract, system };
  }

  // ------------------------------------------------------------ the call --

  it("stamps the three deadlines from the call, exactly addHours of the line's hours", async () => {
    const { contract, system } = await setup("CRITICAL");
    const calledAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const order = await makeOrder(app, { slaSystemId: system.id, calledAt });
    expect(order).toMatchObject({
      status: "OPEN",
      band: "CRITICAL",
      maintenanceContractId: contract.id,
      slaSystemCode: system.code,
      calledAt,
      dueResponseAt: addHours(calledAt, 0.5),
      dueRestoreAt: addHours(calledAt, 2),
      dueReportAt: addHours(calledAt, 24),
      raisedByName: "Κυριάκος Στυλιανού",
      extensionDays: 0,
    });
    expect(order.ref).toMatch(/^NGH-WO-\d{4}-\d{4}$/);
    expect(order.sla).toEqual({ response: "GREEN", restore: "GREEN", report: "GREEN" });
    expect(order.contractorName).toBe(contract.contractorName);
    // R42: the write is on the trail, with the caller as the actor.
    const { rows } = await admin.query(
      "select actor_id, action from ecapital.audit_log where entity_type = 'work_order' and entity_id = $1",
      [order.id],
    );
    expect(rows).toContainEqual({ actor_id: "dev-technician-nicosia", action: "INSERT" });
  });

  it("takes the unit from the asset, and refuses an asset and unit that disagree (400)", async () => {
    const asset = await makeAsset(app);
    const order = await makeOrder(app, { orgUnitId: undefined, assetId: asset.id });
    expect(order.orgUnitId).toBe("nicosia-general");
    expect(order.assetTag).toBe(asset.tag);

    const token = await tokenFor(app, USERS.admin);
    const mismatch = await http()
      .post("/work-orders")
      .set(bearer(token))
      .send({ kind: "CORRECTIVE", source: "OTHER", orgUnitId: "larnaca-general", assetId: asset.id, titleEl: "Ασυμφωνία μονάδας" });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.key).toBe("errors.workOrderUnitMismatch");

    const noUnit = await http()
      .post("/work-orders")
      .set(bearer(token))
      .send({ kind: "CORRECTIVE", source: "OTHER", titleEl: "Χωρίς μονάδα" });
    expect(noUnit.status).toBe(400);
    expect(noUnit.body.key).toBe("errors.workOrderNeedsUnit");
  });

  it("picks the catalogue line from the asset's class when exactly one active line carries it", async () => {
    // Paphos: a unit no other suite gives an agreement, so the one line is ours.
    const contract = await makeContract(app, USERS.admin, { orgUnitId: "paphos-general" });
    const line = await makeSystem(
      app,
      contract.id,
      { band: "CRITICAL", responseHours: 0.5, restoreHours: 2, reportHours: 24, assetClass: "MEDICAL_GAS" },
      USERS.admin,
    );
    const asset = await makeAsset(app, { orgUnitId: "paphos-general", assetClass: "MEDICAL_GAS" }, USERS.admin);
    const order = await makeOrder(app, { orgUnitId: undefined, assetId: asset.id }, USERS.admin);
    expect(order.slaSystemId).toBe(line.id);
    expect(order.band).toBe("CRITICAL");

    // A second line of the same class makes it a person's choice: no timers.
    await makeSystem(app, contract.id, { assetClass: "MEDICAL_GAS" }, USERS.admin);
    const unpicked = await makeOrder(app, { orgUnitId: undefined, assetId: asset.id }, USERS.admin);
    expect(unpicked.slaSystemId).toBeNull();
    expect(unpicked.band).toBeNull();
    expect(unpicked.sla).toEqual({ response: null, restore: null, report: null });
  });

  it("refuses a call sent in the future (400)", async () => {
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await http()
      .post("/work-orders")
      .set(bearer(token))
      .send({
        kind: "CORRECTIVE",
        source: "OTHER",
        orgUnitId: "nicosia-general",
        titleEl: "Από το μέλλον",
        calledAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.workOrderTimeNotValid");
  });

  // ------------------------------------------------------- the extension --

  it("extends the restore deadline by working days and never moves the response one", async () => {
    const { system } = await setup("P1");
    const order = await makeOrder(app, { slaSystemId: system.id });
    const base = addHours(order.calledAt, 24);
    const token = await tokenFor(app, USERS.technicianNicosia);

    const extended = await http()
      .patch(`/work-orders/${order.id}`)
      .set(bearer(token))
      .send({ extensionDays: 5, extensionReasonEl: "Εισαγωγή ανταλλακτικού." });
    expect(extended.status, JSON.stringify(extended.body)).toBe(200);
    expect(extended.body.dueRestoreAt).toBe(addWorkingDays(base, 5));
    expect(extended.body.dueResponseAt).toBe(order.dueResponseAt);
    expect(extended.body.dueReportAt).toBe(order.dueReportAt);

    // A second extension replaces the first rather than stacking on it, and
    // keeps the reason already given.
    const shorter = await http().patch(`/work-orders/${order.id}`).set(bearer(token)).send({ extensionDays: 2 });
    expect(shorter.status).toBe(200);
    expect(shorter.body.dueRestoreAt).toBe(addWorkingDays(base, 2));

    const noReason = await http()
      .patch(`/work-orders/${order.id}`)
      .set(bearer(token))
      .send({ extensionDays: 3, extensionReasonEl: null });
    expect(noReason.status).toBe(422);
    expect(noReason.body.key).toBe("errors.workOrderExtensionNeedsReason");

    const detail = WorkOrderDetail.parse((await http().get(`/work-orders/${order.id}`).set(bearer(token))).body);
    const extensions = detail.events.filter((e) => e.kind === "EXTENSION");
    expect(extensions).toHaveLength(2);
    expect(extensions[0].noteEl).toContain("Εισαγωγή ανταλλακτικού.");
  });

  it("writes CODED for the codes and EDITED for the rest", async () => {
    const order = await makeOrder(app, {});
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await http()
      .patch(`/work-orders/${order.id}`)
      .set(bearer(token))
      .send({ failureCode: "LEAK", causeCode: "WEAR", costEstimate: 450, assignedToEl: "Μ. Ευαγγέλου" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ failureCode: "LEAK", causeCode: "WEAR", remedyCode: null, costEstimate: 450 });
    const detail = WorkOrderDetail.parse((await http().get(`/work-orders/${order.id}`).set(bearer(token))).body);
    const kinds = detail.events.map((e) => e.kind);
    expect(kinds).toEqual(["CREATED", "CODED", "EDITED"]);
  });

  // ------------------------------------------------------------ the steps --

  it("walks a corrective order through every step and stamps each clock", async () => {
    const { system } = await setup("CRITICAL");
    const calledAt = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const order = await makeOrder(app, { slaSystemId: system.id, calledAt });
    const at = (minutes: number) => new Date(Date.parse(calledAt) + minutes * 60_000).toISOString();

    expect((await step(app, order.id, { action: "ACKNOWLEDGE", at: at(20) })).body.respondedAt).toBe(at(20));
    expect((await step(app, order.id, { action: "START", at: at(25) })).body.startedAt).toBe(at(25));
    expect((await step(app, order.id, { action: "PAUSE", at: at(40), noteEl: "Αναμονή ανταλλακτικού" })).body.status).toBe("PAUSED");
    expect((await step(app, order.id, { action: "RESUME", at: at(60) })).body.status).toBe("IN_PROGRESS");
    const restored = (await step(app, order.id, { action: "RESTORE", at: at(150) })).body;
    expect(restored.restoredAt).toBe(at(150));
    // Two hours to restore: thirty minutes late.
    expect(restored.sla.restore).toBe("BREACHED");
    expect(restored.sla.response).toBe("GREEN");
    expect(restored.downtimeHours).toBe(2.5);

    const done = await step(app, order.id, { action: "COMPLETE", at: at(170), costActual: 320, ...CODES });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const detail = WorkOrderDetail.parse(done.body);
    expect(detail).toMatchObject({
      status: "COMPLETED",
      completedAt: at(170),
      reportReceivedAt: at(170),
      costActual: 320,
      ...CODES,
    });
    expect(detail.events.map((e) => e.kind)).toEqual([
      "CREATED",
      "ACKNOWLEDGED",
      "STARTED",
      "PAUSED",
      "RESUMED",
      "RESTORED",
      "CODED",
      "COMPLETED",
    ]);
    // Ordered by when it happened, not by when it was typed.
    const times = detail.events.slice(1).map((e) => e.at);
    expect([...times].sort()).toEqual(times);
  });

  it("refuses a step out of order (409) and a time before the call or in the future (400)", async () => {
    const order = await makeOrder(app, {});
    const outOfOrder = await step(app, order.id, { action: "RESTORE" });
    expect(outOfOrder.status).toBe(409);
    expect(outOfOrder.body.key).toBe("errors.workOrderStepNotAllowed");

    const before = await step(app, order.id, {
      action: "ACKNOWLEDGE",
      at: new Date(Date.parse(order.calledAt) - 60_000).toISOString(),
    });
    expect(before.status).toBe(400);
    expect(before.body.key).toBe("errors.workOrderTimeNotValid");
    const future = await step(app, order.id, {
      action: "ACKNOWLEDGE",
      at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(future.status).toBe(400);
  });

  it("starting is responding: START on an OPEN call stamps the response too", async () => {
    const { system } = await setup("P1");
    const order = await makeOrder(app, { slaSystemId: system.id });
    const started = await step(app, order.id, { action: "START" });
    expect(started.status).toBe(200);
    expect(started.body.respondedAt).toBe(started.body.startedAt);
  });

  it("refuses to complete a corrective order without all three codes (422)", async () => {
    const order = await makeOrder(app, {});
    await step(app, order.id, { action: "START" });
    const uncoded = await step(app, order.id, { action: "COMPLETE", failureCode: "LEAK" });
    expect(uncoded.status).toBe(422);
    expect(uncoded.body.key).toBe("errors.workOrderNeedsCodes");
    const coded = await step(app, order.id, { action: "COMPLETE", ...CODES });
    expect(coded.status).toBe(200);

    // …and the codes cannot be cleared after the fact.
    const token = await tokenFor(app, USERS.technicianNicosia);
    const cleared = await http().patch(`/work-orders/${order.id}`).set(bearer(token)).send({ causeCode: null });
    expect(cleared.status).toBe(422);
    expect(cleared.body.key).toBe("errors.workOrderNeedsCodes");
  });

  it("completes a statutory order without codes, and cancels only with a reason", async () => {
    const statutory = await makeOrder(app, { kind: "STATUTORY" });
    await step(app, statutory.id, { action: "START" });
    expect((await step(app, statutory.id, { action: "COMPLETE" })).status).toBe(200);

    const order = await makeOrder(app, {});
    const bare = await step(app, order.id, { action: "CANCEL" });
    expect(bare.status).toBe(422);
    expect(bare.body.key).toBe("errors.workOrderCancelNeedsReason");
    const cancelled = await step(app, order.id, { action: "CANCEL", noteEl: "Διπλή κλήση." });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelledAt).not.toBeNull();
    expect(cancelled.body.sla).toEqual({ response: null, restore: null, report: null });
    expect((await step(app, order.id, { action: "START" })).status).toBe(409);
  });

  // ------------------------------------------------------------- who --

  it("lets the clinical approver raise a call and add a note, but not take a step (403)", async () => {
    const order = await makeOrder(app, { source: "NURSING" }, USERS.clinicalNicosia);
    expect(order.raisedByName).toBe("Γιώργος Σάββα");
    const token = await tokenFor(app, USERS.clinicalNicosia);
    const note = await http()
      .post(`/work-orders/${order.id}/notes`)
      .set(bearer(token))
      .send({ noteEl: "Η θερμοκρασία ανεβαίνει ακόμη." });
    expect(note.status).toBe(201);
    expect(WorkOrderEvent.parse(note.body)).toMatchObject({ kind: "NOTE", byName: "Γιώργος Σάββα" });

    expect((await step(app, order.id, { action: "ACKNOWLEDGE" }, USERS.clinicalNicosia)).status).toBe(403);
    const patch = await http().patch(`/work-orders/${order.id}`).set(bearer(token)).send({ costEstimate: 10 });
    expect(patch.status).toBe(403);
  });

  it("lets a technician raise and work an order", async () => {
    const order = await makeOrder(app, {}, USERS.technicianNicosia);
    expect((await step(app, order.id, { action: "ACKNOWLEDGE" })).status).toBe(200);
  });

  it("hides a Nicosia order from Larnaca's engineer (404 on read, write and step)", async () => {
    const order = await makeOrder(app, {});
    const token = await tokenFor(app, USERS.engineerLarnaca);
    expect((await http().get(`/work-orders/${order.id}`).set(bearer(token))).status).toBe(404);
    expect((await step(app, order.id, { action: "ACKNOWLEDGE" }, USERS.engineerLarnaca)).status).toBe(404);
    const list = await http().get(`/work-orders?q=${encodeURIComponent(order.ref)}`).set(bearer(token));
    expect(list.body.total).toBe(0);
  });

  it("lets the auditor read an order and refuses every write (403)", async () => {
    const order = await makeOrder(app, {});
    const token = await tokenFor(app, USERS.auditor);
    expect((await http().get(`/work-orders/${order.id}`).set(bearer(token))).status).toBe(200);
    expect(
      (await http().post("/work-orders").set(bearer(token)).send({ kind: "CORRECTIVE", source: "OTHER", orgUnitId: "nicosia-general", titleEl: "Ελεγκτής" })).status,
    ).toBe(403);
    expect((await step(app, order.id, { action: "ACKNOWLEDGE" }, USERS.auditor)).status).toBe(403);
    expect(
      (await http().post(`/work-orders/${order.id}/notes`).set(bearer(token)).send({ noteEl: "Σημείωση" })).status,
    ).toBe(403);
  });

  // ------------------------------------------------------------ the list --

  it("lists with repeated or comma-separated statuses, the timer filter and the caller's own", async () => {
    const { contract, system } = await setup("CRITICAL");
    const late = await makeOrder(app, {
      slaSystemId: system.id,
      calledAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    });
    const fresh = await makeOrder(app, { slaSystemId: system.id });
    await step(app, fresh.id, { action: "ACKNOWLEDGE" });
    const token = await tokenFor(app, USERS.technicianNicosia);
    const base = `/work-orders?maintenanceContractId=${contract.id}`;

    const comma = await http().get(`${base}&status=OPEN,ACKNOWLEDGED`).set(bearer(token));
    expect(comma.status).toBe(200);
    expect(comma.body.total).toBe(2);
    const repeated = await http().get(`${base}&status=OPEN&status=ACKNOWLEDGED`).set(bearer(token));
    expect(repeated.body.total).toBe(2);
    const open = await http().get(`${base}&status=OPEN`).set(bearer(token));
    expect((open.body.items as WorkOrderListRow[]).map((r) => r.id)).toEqual([late.id]);

    const red = await http().get(`${base}&slaState=RED`).set(bearer(token));
    expect((red.body.items as WorkOrderListRow[]).map((r) => r.id)).toEqual([late.id]);
    const green = await http().get(`${base}&slaState=GREEN`).set(bearer(token));
    expect((green.body.items as WorkOrderListRow[]).map((r) => r.id)).toContain(fresh.id);

    const mine = await http().get(`${base}&mine=true&sort=ref&dir=asc`).set(bearer(token));
    expect((mine.body.items as WorkOrderListRow[]).map((r) => r.ref)).toEqual([late.ref, fresh.ref].sort());

    const row = WorkOrderListRow.parse(open.body.items[0]);
    expect(row).toMatchObject({ band: "CRITICAL", contractorName: contract.contractorName, sla: { response: "RED" } });

    const bad = await http().get("/work-orders?status=SOMETIMES").set(bearer(token));
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.workOrderQueryNotValid");
  });

  it("carries the PM checklist and the repeat count on the detail", async () => {
    // The seed's booster pump has three corrective orders in twelve months.
    const token = await tokenFor(app, USERS.estatesNicosia);
    const list = await http()
      .get(`/work-orders?q=${encodeURIComponent("Θόρυβος και κραδασμοί στο πιεστικό")}`)
      .set(bearer(token));
    const id = list.body.items[0]?.id;
    expect(id).toBeDefined();
    const detail = WorkOrderDetail.parse((await http().get(`/work-orders/${id}`).set(bearer(token))).body);
    expect(detail.repeatCount).toBeGreaterThanOrEqual(3);
    expect(detail.backlogItemId).not.toBeNull();

    const pm = await http()
      .get(`/work-orders?kind=PM&q=${encodeURIComponent("Μηνιαία συντήρηση ψύκτη Ψ-1 — Αύγουστος")}`)
      .set(bearer(token));
    const pmDetail = WorkOrderDetail.parse((await http().get(`/work-orders/${pm.body.items[0].id}`).set(bearer(token))).body);
    expect(pmDetail.checklistEl).toContain("ψυκτικού");
  });

  // ---------------------------------------------------------- the papers --

  it("files a photograph with eArchive as a work-order document and puts a PHOTO line in the story", async () => {
    const order = await makeOrder(app, {});
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await http()
      .post(`/work-orders/${order.id}/documents`)
      .set(bearer(token))
      .field("titleEl", "Φωτογραφία διαρροής")
      .attach("file", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]), {
        filename: "leak.jpg",
        contentType: "image/jpeg",
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const event = WorkOrderEvent.parse(response.body);
    expect(event).toMatchObject({ kind: "PHOTO", documentTitle: "Φωτογραφία διαρροής" });

    const { rows } = await admin.query(
      "select source_module, status, meta from ecapital.dms_outbox where document_id = $1",
      [event.documentId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].source_module).toBe("work_order_document");
    expect(rows[0].meta.source_ref).toBe(`work_order_doc:${order.id}:1`);
    expect(rows[0].meta.category).toBe("Συμβάσεις");
    expect(rows[0].meta.personal_data).toBe(false);

    const clinical = await tokenFor(app, USERS.clinicalNicosia);
    const refused = await http()
      .post(`/work-orders/${order.id}/documents`)
      .set(bearer(clinical))
      .attach("file", Buffer.from("%PDF-1.7\n%%EOF\n"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(refused.status).toBe(403);
  });

  // ---------------------------------------------------------- R35, R36 --

  it("sends an order's work to the backlog with the order's asset, line and title", async () => {
    const { system } = await setup("P1");
    const asset = await makeAsset(app);
    const order = await makeOrder(app, { slaSystemId: system.id, assetId: asset.id, orgUnitId: undefined });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .post(`/work-orders/${order.id}/backlog`)
      .set(bearer(token))
      .send({ kind: "REPAIR", riskBand: "MODERATE", costEstimate: 4200 });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const item = BacklogItem.parse(response.body);
    expect(item).toMatchObject({
      titleEl: order.titleEl,
      assetId: asset.id,
      slaSystemId: system.id,
      sourceWorkOrderId: order.id,
      sourceWorkOrderRef: order.ref,
      autoDrafted: false,
      status: "OPEN",
    });
    const detail = WorkOrderDetail.parse((await http().get(`/work-orders/${order.id}`).set(bearer(token))).body);
    expect(detail.backlogItemId).toBe(item.id);
    expect(detail.events.at(-1)?.kind).toBe("TO_BACKLOG");

    const technician = await tokenFor(app, USERS.technicianNicosia);
    expect(
      (await http().post(`/work-orders/${order.id}/backlog`).set(bearer(technician)).send({ kind: "REPAIR", riskBand: "LOW" })).status,
    ).toBe(403);
  });

  it("R36: the third corrective order on an asset drafts one replacement item, the fourth none", async () => {
    const asset = await makeAsset(app, { replacementCostEst: 80000, criticality: 1 });
    const done: WorkOrder[] = [];
    for (let n = 0; n < 4; n += 1) {
      const order = await makeOrder(app, { assetId: asset.id, orgUnitId: undefined, titleEl: `Επαναλαμβανόμενη βλάβη ${n + 1} ${uniq()}` });
      await step(app, order.id, { action: "START" });
      const completed = await step(app, order.id, { action: "COMPLETE", costActual: 100, ...CODES });
      expect(completed.status).toBe(200);
      done.push(completed.body);
      const token = await tokenFor(app, USERS.estatesNicosia);
      const items = await http().get(`/backlog?assetId=${asset.id}&autoDrafted=true`).set(bearer(token));
      expect(items.body.total).toBe(n < 2 ? 0 : 1);
    }
    const token = await tokenFor(app, USERS.estatesNicosia);
    const items = (await http().get(`/backlog?assetId=${asset.id}`).set(bearer(token))).body.items as BacklogItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "REPLACEMENT",
      autoDrafted: true,
      autoReason: "THREE_CORRECTIVE_IN_12_MONTHS",
      riskBand: "HIGH",
      costEstimate: 80000,
      sourceWorkOrderId: done[2].id,
      raisedById: null,
    });
    expect(items[0].historyEl?.split("\n")).toHaveLength(4);
    expect(items[0].historyEl).toContain(done[0].ref);

    const third = WorkOrderDetail.parse((await http().get(`/work-orders/${done[2].id}`).set(bearer(token))).body);
    expect(third.backlogItemId).toBe(items[0].id);
    expect(third.events.some((e) => e.kind === "TO_BACKLOG")).toBe(true);
    expect(third.repeatCount).toBe(4);
  });

  it("R36: one repair above half the replacement estimate drafts the item on its own", async () => {
    const asset = await makeAsset(app, { replacementCostEst: 1000, criticality: 4 });
    const order = await makeOrder(app, { assetId: asset.id, orgUnitId: undefined });
    await step(app, order.id, { action: "START" });
    await step(app, order.id, { action: "COMPLETE", costActual: 600, ...CODES });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const items = (await http().get(`/backlog?assetId=${asset.id}`).set(bearer(token))).body.items as BacklogItem[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ autoReason: "REPAIR_COST_OVER_THRESHOLD", riskBand: "LOW", costEstimate: 1000 });
  });
});
