import type { INestApplication } from "@nestjs/common";
import ExcelJS from "exceljs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { binary } from "./maintenance-support";

/**
 * UAT 25/11/2026 — `POST /exports/table`, the export every `Table` without
 * its own uses. Any signed-in user, a read-only one included (it writes
 * nothing); a body over Nest's default 100 kB still gets through; a body
 * that is not a table is a 400 with a sentence.
 */
describe("POST /exports/table", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  // About 300 kB of JSON: three times what the default parser would take.
  const body = {
    title: "Έργα",
    sheetName: "Έργα",
    source: "/projects",
    columns: [
      { header: "Κωδικός", kind: "text" },
      { header: "Προϋπολογισμός", numeric: true, kind: "money" },
      { header: "Λήξη", numeric: true, kind: "date" },
    ],
    rows: Array.from({ length: 5_000 }, (_, i) => [`PRJ-${String(i).padStart(5, "0")}-ΛΕΥΚΩΣΙΑ`, i * 10.5, "2026-11-24"]),
  };

  it("answers a read-only account with the workbook as an attachment", async () => {
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);
    const token = await tokenFor(app, USERS.auditor);
    const response = await http()
      .post("/exports/table")
      .set(bearer(token))
      .send(body)
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    expect(String(response.headers["content-disposition"])).toMatch(
      /^attachment; filename=".*\.xlsx"; filename\*=UTF-8''%CE%88%CF%81%CE%B3%CE%B1-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(response.body);
    const sheet = book.worksheets[0];
    expect(sheet?.getCell("B5002").formula).toBe("SUBTOTAL(9,B2:B5001)");
  });

  it("refuses a body that is not a table, with a sentence", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await http()
      .post("/exports/table")
      .set(bearer(token))
      .send({ ...body, rows: [["only one value"]] });
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.tableExportNotValid");
  });

  it("refuses a caller with no token", async () => {
    const response = await http().post("/exports/table").send(body);
    expect(response.status).toBe(401);
  });

  it("leaves every other route on the default body limit", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await http()
      .post("/projects")
      .set(bearer(token))
      .send({ padding: "x".repeat(200 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body.key).toBe("errors.bodyTooLarge");
  });
});
