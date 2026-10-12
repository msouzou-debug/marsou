import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { WorkOrderDetail, WorkOrderEvent } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contentFilename } from "../src/documents/documents.service";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { binary, makeAsset, makeOrder } from "./maintenance-support";

/**
 * The preview (S17, S18a): `GET /documents/:id/content` answers the
 * operational copy of a filed document. The row policy decides who sees it
 * (ADR-0010), exactly as it decides who sees the row in a list: the route
 * reads through the caller's transaction and has no `@Needs` of its own.
 */

/** The smallest PNG there is: the signature, IHDR for 1×1, IDAT, IEND. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);
const PDF = Buffer.from("%PDF-1.7\nΕγχειρίδιο προεπισκόπησης\n%%EOF\n", "utf8");

describe("a document's content", () => {
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

  async function photo(title = "Φωτογραφία πίνακα") {
    const order = await makeOrder(app, {});
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await http()
      .post(`/work-orders/${order.id}/documents`)
      .set(bearer(token))
      .field("titleEl", title)
      .attach("file", PNG, { filename: "panel.png", contentType: "image/png" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { order, token, event: WorkOrderEvent.parse(response.body) };
  }

  it("answers a work order's photo to the technician who filed it, byte for byte, inline", async () => {
    const { order, token, event } = await photo();
    expect(event.documentMime).toBe("image/png");

    const response = await http()
      .get(`/documents/${event.documentId}/content`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(response.body as Buffer, PNG)).toBe(0);
    expect(response.headers["content-length"]).toBe(String(PNG.length));
    expect(response.headers["content-disposition"]).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent("Φωτογραφία πίνακα.png")}`,
    );
    expect(response.headers["cache-control"]).toBe("private, max-age=300");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");

    // The story says what the file is, so the screen can draw it.
    const detail = WorkOrderDetail.parse(
      (await http().get(`/work-orders/${order.id}`).set(bearer(token))).body,
    );
    const line = detail.events.find((e) => e.documentId === event.documentId);
    expect(line).toMatchObject({ kind: "PHOTO", documentMime: "image/png" });
    expect(detail.events.find((e) => e.kind === "CREATED")?.documentMime).toBeNull();
  });

  it("hides a Nicosia photo from Larnaca's engineer: 404, not 403", async () => {
    const { event } = await photo();
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await http().get(`/documents/${event.documentId}/content`).set(bearer(token));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.documentNotFound");
  });

  it("answers 404 for an id that is not a document, and for one that is not an id", async () => {
    const token = await tokenFor(app, USERS.admin);
    const unknown = await http()
      .get("/documents/00000000-0000-4000-8000-000000000000/content")
      .set(bearer(token));
    expect(unknown.status).toBe(404);
    expect(unknown.body.key).toBe("errors.documentNotFound");
    const garbage = await http().get("/documents/not-an-id/content").set(bearer(token));
    expect(garbage.status).toBe(404);
  });

  it("needs a token like every other route", async () => {
    const { event } = await photo();
    expect((await http().get(`/documents/${event.documentId}/content`)).status).toBe(401);
  });

  it("answers 404 when the store has lost the bytes, and 404 for a tombstone", async () => {
    const lost = await photo("Χαμένη φωτογραφία");
    const { rows } = await admin.query<{ object_key: string }>(
      "select object_key from ecapital.document where id = $1",
      [lost.event.documentId],
    );
    await rm(join(process.env.DOCUMENT_STORE_DIR as string, rows[0]!.object_key));
    const gone = await http().get(`/documents/${lost.event.documentId}/content`).set(bearer(lost.token));
    expect(gone.status).toBe(404);
    expect(gone.body.key).toBe("errors.documentNotFound");

    const deleted = await photo("Διαγραμμένη φωτογραφία");
    await admin.query("update ecapital.document set deleted_at = now() where id = $1", [
      deleted.event.documentId,
    ]);
    const tombstone = await http()
      .get(`/documents/${deleted.event.documentId}/content`)
      .set(bearer(deleted.token));
    expect(tombstone.status).toBe(404);
  });

  it("opens an asset's PDF for whoever may read the asset's unit", async () => {
    const asset = await makeAsset(app);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const filed = await http()
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(estates))
      .field("kind", "OM_MANUAL")
      .field("titleEl", "Εγχειρίδιο λειτουργίας")
      .attach("file", PDF, { filename: "manual.pdf", contentType: "application/pdf" });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);

    const auditor = await tokenFor(app, USERS.auditor);
    const response = await http()
      .get(`/documents/${filed.body.documentId}/content`)
      .set(bearer(auditor))
      .buffer()
      .parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(Buffer.compare(response.body as Buffer, PDF)).toBe(0);
    expect(response.headers["content-disposition"]).toMatch(/^inline; filename\*=UTF-8''/);
    expect(decodeURIComponent(response.headers["content-disposition"].split("''")[1]!)).toBe(
      "Εγχειρίδιο λειτουργίας.pdf",
    );

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    expect(
      (await http().get(`/documents/${filed.body.documentId}/content`).set(bearer(larnaca))).status,
    ).toBe(404);
  });

  it("names the file after its title, with the type's extension once", () => {
    expect(contentFilename("Φωτογραφία πίνακα", "IMG_0001.JPG", "image/jpeg")).toBe("Φωτογραφία πίνακα.jpg");
    expect(contentFilename("leak.jpeg", "leak.jpeg", "image/jpeg")).toBe("leak.jpeg");
    expect(contentFilename("Έκθεση.pdf", "report.pdf", "application/pdf")).toBe("Έκθεση.pdf");
    expect(contentFilename("Πίνακας 1/2", "x.png", "image/png")).toBe("Πίνακας 1-2.png");
    expect(contentFilename("   ", "x.pdf", "application/pdf")).toBe("document.pdf");
  });
});
