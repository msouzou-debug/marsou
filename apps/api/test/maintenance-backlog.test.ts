import type { INestApplication } from "@nestjs/common";
import { BacklogItem, BacklogSummaryRow } from "@ecapital/shared";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { binary, makeAsset, uniq } from "./maintenance-support";

/**
 * M5 — Εκκρεμότητες συντήρησης (R35, R36; ADR-0031 §7–8): the backlog
 * banded by risk, «Σε έργο» and the export with live formulas. Every test
 * makes its own items and reads them back by id or title, never by a count
 * another suite can move.
 */
describe("maintenance backlog", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function makeItem(body: Record<string, unknown> = {}, email: string = USERS.estatesNicosia) {
    const token = await tokenFor(app, email);
    const response = await http()
      .post("/backlog")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        kind: "REPAIR",
        titleEl: `Εκκρεμότητα δοκιμής ${uniq()}`,
        riskBand: "SIGNIFICANT",
        costEstimate: 25000,
        ...body,
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return BacklogItem.parse(response.body);
  }

  it("seeds Nicosia's items: three auto-drafted, one funded by a seeded project", async () => {
    const token = await tokenFor(app, USERS.admin);
    const auto = await http().get("/backlog?autoDrafted=true&orgUnitId=nicosia-general").set(bearer(token));
    const titles = (auto.body.items as BacklogItem[]).map((i) => i.titleEl);
    expect(titles).toContain("Αντικατάσταση: Πιεστικό συγκρότημα ύδρευσης");
    expect(titles).toContain("Αντικατάσταση: Ανεμιστήρας απαγωγής ΚΚΜ-2");
    expect(titles).toContain("Αντικατάσταση: Ικρίωμα δικτύου κτιρίου Α");
    const funded = await http().get("/backlog?status=FUNDED&orgUnitId=nicosia-general").set(bearer(token));
    const item = (funded.body.items as BacklogItem[]).find(
      (i) => i.titleEl === "Αναβάθμιση κεντρικού πίνακα πυρανίχνευσης",
    );
    expect(item?.targetProjectCode).toMatch(/^NGH-/);
  });

  it("seeds an auto-drafted item and a funded one for Limassol, Paphos and Famagusta", async () => {
    const token = await tokenFor(app, USERS.admin);
    for (const unit of ["limassol-general", "paphos-general", "famagusta-general"]) {
      const list = await http().get(`/backlog?orgUnitId=${unit}&pageSize=100`).set(bearer(token));
      expect(list.status, unit).toBe(200);
      const items = list.body.items as BacklogItem[];
      expect(items.some((i) => i.autoDrafted && i.historyEl), unit).toBe(true);
      expect(items.some((i) => i.status === "FUNDED" && i.targetProjectCode), unit).toBe(true);
      expect(items.some((i) => i.status === "DONE"), unit).toBe(true);
    }
  });

  it("records an item, takes the unit from the asset and refuses one with no unit", async () => {
    const asset = await makeAsset(app);
    const item = await makeItem({ orgUnitId: undefined, assetId: asset.id, kind: "REPLACEMENT", riskBand: "HIGH" });
    expect(item).toMatchObject({
      orgUnitId: "nicosia-general",
      assetTag: asset.tag,
      status: "OPEN",
      autoDrafted: false,
      raisedByName: "Ανδρέας Παπαδόπουλος",
    });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const none = await http()
      .post("/backlog")
      .set(bearer(token))
      .send({ kind: "REPAIR", titleEl: "Χωρίς μονάδα", riskBand: "LOW" });
    expect(none.status).toBe(400);
  });

  it("lets the engineer keep the backlog and refuses the technician and the auditor (403)", async () => {
    await makeItem({}, USERS.admin);
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const theirs = await http()
      .post("/backlog")
      .set(bearer(engineer))
      .send({ orgUnitId: "larnaca-general", kind: "UPGRADE", titleEl: "Αναβάθμιση Λάρνακας", riskBand: "LOW" });
    expect(theirs.status).toBe(201);
    for (const email of [USERS.technicianNicosia, USERS.auditor, USERS.clinicalNicosia]) {
      const token = await tokenFor(app, email);
      const refused = await http()
        .post("/backlog")
        .set(bearer(token))
        .send({ orgUnitId: "nicosia-general", kind: "REPAIR", titleEl: "Όχι εδώ", riskBand: "LOW" });
      expect(refused.status, email).toBe(403);
    }
    // Larnaca's engineer may not write Nicosia's backlog: the row policy says so.
    const cross = await http()
      .post("/backlog")
      .set(bearer(engineer))
      .send({ orgUnitId: "nicosia-general", kind: "REPAIR", titleEl: "Άλλη μονάδα", riskBand: "LOW" });
    expect([403, 404]).toContain(cross.status);
  });

  it("refuses FUNDED without a project (422) and stamps closedAt on DONE", async () => {
    const item = await makeItem();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const funded = await http().patch(`/backlog/${item.id}`).set(bearer(token)).send({ status: "FUNDED" });
    expect(funded.status).toBe(422);
    expect(funded.body.key).toBe("errors.backlogFundedNeedsProject");

    const done = await http().patch(`/backlog/${item.id}`).set(bearer(token)).send({ status: "DONE" });
    expect(done.status).toBe(200);
    expect(done.body.closedAt).not.toBeNull();
    const reopened = await http()
      .patch(`/backlog/${item.id}`)
      .set(bearer(token))
      .send({ status: "OPEN", riskBand: "HIGH" });
    expect(reopened.body).toMatchObject({ status: "OPEN", closedAt: null, riskBand: "HIGH", titleEl: item.titleEl });
  });

  it("«Σε έργο»: drafts a project at IDEA with the item's cost and funds the item, once", async () => {
    const asset = await makeAsset(app, { assetClass: "BIOMEDICAL" });
    const item = await makeItem({ assetId: asset.id, kind: "REPLACEMENT", costEstimate: 48000, descriptionEl: "Τέλος ζωής." });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .post(`/backlog/${item.id}/to-project`)
      .set(bearer(token))
      .send({ titleEl: "Αντικατάσταση αναπνευστήρα" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body.projectCode).toMatch(/^NGH-\d{4}-\d+/);
    expect(BacklogItem.parse(response.body.item)).toMatchObject({
      status: "FUNDED",
      targetProjectId: response.body.projectId,
      targetProjectCode: response.body.projectCode,
    });

    const project = await http().get(`/projects/${response.body.projectId}`).set(bearer(token));
    expect(project.status).toBe(200);
    expect(project.body).toMatchObject({
      phase: "IDEA",
      titleEl: "Αντικατάσταση αναπνευστήρα",
      category: "EQUIPMENT",
      approvedBudget: 48000,
      orgUnitId: "nicosia-general",
    });

    const again = await http().post(`/backlog/${item.id}/to-project`).set(bearer(token)).send({});
    expect(again.status).toBe(409);
    expect(again.body.key).toBe("errors.backlogNotOpen");
  });

  it("keeps «Σε έργο» to the head of estates and the administrator (403 for the engineer)", async () => {
    const item = await makeItem();
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    expect((await http().post(`/backlog/${item.id}/to-project`).set(bearer(engineer)).send({})).status).toBe(403);
  });

  it("sums OPEN and FUNDED by unit and band, funded and unfunded apart", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const before = await http().get("/backlog/summary?orgUnitId=nicosia-general").set(bearer(token));
    const row = (rows: BacklogSummaryRow[]) => rows.find((r) => r.riskBand === "MODERATE");
    const was = row(before.body) ?? { count: 0, unfundedCost: 0 };
    await makeItem({ riskBand: "MODERATE", costEstimate: 1234.5 });
    const after = await http().get("/backlog/summary?orgUnitId=nicosia-general").set(bearer(token));
    expect(after.status).toBe(200);
    const now = BacklogSummaryRow.parse(row(after.body));
    expect(now.unitName).toBe("Γενικό Νοσοκομείο Λευκωσίας");
    expect(now.count).toBe(was.count + 1);
    expect(now.unfundedCost).toBeCloseTo(was.unfundedCost + 1234.5, 2);
    expect(now.costEstimate).toBeCloseTo(now.fundedCost + now.unfundedCost, 2);
  });

  it("lists worst band first and filters by repeated statuses", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const list = await http()
      .get("/backlog?orgUnitId=nicosia-general&status=OPEN,FUNDED&pageSize=100")
      .set(bearer(token));
    expect(list.status).toBe(200);
    const items = list.body.items as BacklogItem[];
    expect(items.every((i) => i.status === "OPEN" || i.status === "FUNDED")).toBe(true);
    const rank = { HIGH: 4, SIGNIFICANT: 3, MODERATE: 2, LOW: 1 } as const;
    const ranks = items.map((i) => rank[i.riskBand]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
  });

  it("exports the items and a unit × band summary whose figures are COUNTIFS and SUMIFS formulas", async () => {
    await makeItem({ riskBand: "LOW", costEstimate: 100 });
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .get("/backlog/export.xlsx?orgUnitId=nicosia-general")
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    expect(workbook.worksheets.map((s) => s.name)).toEqual(["Εκκρεμότητες", "Σύνοψη"]);
    const items = workbook.getWorksheet("Εκκρεμότητες") as ExcelJS.Worksheet;
    expect(items.getCell("A1").value).toBe("Μονάδα");
    expect(items.getCell("A3").value).toBe("Γενικό Νοσοκομείο Λευκωσίας");
    const summary = workbook.getWorksheet("Σύνοψη") as ExcelJS.Worksheet;
    expect(summary.getCell("A3").value).toBe("Γενικό Νοσοκομείο Λευκωσίας");
    for (const address of ["B3", "C3", "F3", "G3", "K3", "L3", "B4", "L4"]) {
      const cell = summary.getCell(address).value as { formula?: string } | null;
      expect(cell?.formula, address).toBeTruthy();
    }
    expect((summary.getCell("B3").value as { formula: string }).formula).toContain("COUNTIFS(");
    expect((summary.getCell("G3").value as { formula: string }).formula).toContain("SUMIFS(");
  });
});
