import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";

/**
 * M4 — an asset's papers (R28), its label (R29) and the replacement
 * forecast (R30).
 *
 * The rule the document half exists for is ADR-0023's first one, reached
 * through the same service and not a second implementation of it: the
 * `document` row, the `dms_outbox` item and the `asset_document` link are
 * written in one transaction.
 */
const PDF = Buffer.from("%PDF-1.7\nΕγχειρίδιο δοκιμής\n%%EOF\n", "utf8");

describe("an asset's papers, its label and the forecast", () => {
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

  let made = 0;
  async function makeAsset(body: Record<string, unknown> = {}) {
    made += 1;
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post("/assets")
      .set(bearer(token))
      .send({
        orgUnitId: "nicosia-general",
        nameEl: `Πάγιο εγγράφων ${Date.now()}-${made}`,
        assetClass: "HVAC",
        criticality: 2,
        capitalCost: 12000,
        commissionedDate: "2024-03-01",
        ...body,
      });
    return response.body as { id: string; tag: string; nameEl: string };
  }

  async function outboxRow(sourceRef: string) {
    const { rows } = await admin.query<{
      source_module: string;
      status: string;
      document_id: string;
      org_unit_id: string;
      meta: Record<string, unknown>;
    }>("select * from ecapital.dms_outbox where source_ref = $1", [sourceRef]);
    return rows[0];
  }

  // -------------------------------------------------------- the papers --

  it("writes the document, the queue item and the link in one transaction", async () => {
    const asset = await makeAsset();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(token))
      .field("kind", "OM_MANUAL")
      .attach("file", PDF, { filename: "manual.pdf", contentType: "application/pdf" });

    expect(response.status).toBe(201);
    expect(response.body.kind).toBe("OM_MANUAL");
    expect(response.body.assetId).toBe(asset.id);
    expect(response.body.size).toBe(PDF.length);
    // eCapital never invents a protocol number; it arrives from eArchive.
    expect(response.body.protocolNumber).toBeNull();
    expect(response.body.filedAt).toBeNull();

    const queued = await outboxRow(`asset_doc:${asset.id}:1`);
    expect(queued).toBeDefined();
    expect(queued.source_module).toBe("asset_document");
    expect(queued.status).toBe("QUEUED");
    expect(queued.org_unit_id).toBe("nicosia-general");
    expect(queued.document_id).toBe(response.body.documentId);

    const { rows: links } = await admin.query(
      "select * from ecapital.asset_document where asset_id = $1",
      [asset.id],
    );
    expect(links).toHaveLength(1);
  });

  it("numbers the papers of one asset, so the second is :2 and not a correction of the first", async () => {
    const asset = await makeAsset();
    const token = await tokenFor(app, USERS.estatesNicosia);
    for (const kind of ["OM_MANUAL", "CERT"]) {
      await request(app.getHttpServer())
        .post(`/assets/${asset.id}/documents`)
        .set(bearer(token))
        .field("kind", kind)
        .attach("file", Buffer.from(`${PDF.toString()}${kind}`), {
          filename: `${kind}.pdf`,
          contentType: "application/pdf",
        });
    }
    expect(await outboxRow(`asset_doc:${asset.id}:1`)).toBeDefined();
    const second = await outboxRow(`asset_doc:${asset.id}:2`);
    expect(second).toBeDefined();
    // A manual is not a correction of a certificate, so nothing supersedes.
    expect(second.meta.related).toEqual([]);
  });

  it("files the contract papers under «Συμβάσεις» and the estate's own under «Διοίκηση»", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    for (const [kind, category] of [
      ["COMMISSIONING", "Συμβάσεις"],
      ["CERT", "Συμβάσεις"],
      ["WARRANTY", "Συμβάσεις"],
      ["OM_MANUAL", "Διοίκηση"],
      ["DRAWING", "Διοίκηση"],
      ["PHOTO", "Διοίκηση"],
    ] as const) {
      const asset = await makeAsset();
      await request(app.getHttpServer())
        .post(`/assets/${asset.id}/documents`)
        .set(bearer(token))
        .field("kind", kind)
        .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
      const queued = await outboxRow(`asset_doc:${asset.id}:1`);
      expect(queued.meta.category, kind).toBe(category);
      // The folder hint is the unit's own code, which since ADR-0024 is
      // eArchive's site code with nothing in between.
      expect(queued.meta.folder_hints).toEqual([
        { hospital: "NGH", title: "Γενικό Νοσοκομείο Λευκωσίας" },
      ]);
      expect(queued.meta.source_url).toBe(`http://localhost:3000/assets/${asset.id}`);
      expect(queued.meta.personal_data).toBe(false);
    }
  });

  it("keeps the bytes' own hash and refuses a type eArchive does not take", async () => {
    const asset = await makeAsset();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const ok = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(token))
      .field("kind", "DRAWING")
      .attach("file", PDF, { filename: "drawing.pdf", contentType: "application/pdf" });
    expect(ok.body.mime).toBe("application/pdf");
    const { rows } = await admin.query<{ sha256: string }>(
      "select sha256 from ecapital.document where id = $1",
      [ok.body.documentId],
    );
    expect(rows[0].sha256).toBe(createHash("sha256").update(PDF).digest("hex"));

    // No DWG and no ZIP: an archive that cannot read what it holds is a
    // cupboard (ADR-0023).
    const refused = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(token))
      .field("kind", "DRAWING")
      .attach("file", Buffer.from("AC1027"), {
        filename: "plan.dwg",
        contentType: "image/vnd.dwg",
      });
    expect(refused.status).toBe(422);
  });

  it("needs a kind and a file, and a role that files documents", async () => {
    const asset = await makeAsset();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const noKind = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
    expect(noKind.status).toBe(400);
    expect(noKind.body.key).toBe("errors.assetDocumentKindNotValid");

    const noFile = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(token))
      .field("kind", "PHOTO");
    expect(noFile.status).toBe(400);

    const technician = await tokenFor(app, USERS.technicianNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/assets/${asset.id}/documents`)
      .set(bearer(technician))
      .field("kind", "PHOTO")
      .attach("file", PDF, { filename: "p.pdf", contentType: "application/pdf" });
    expect(refused.status).toBe(403);
  });

  it("shows the seeded papers with the protocol numbers eArchive gave them", async () => {
    const { rows } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where name_el = 'Συστοιχία ιατρικών αερίων Α'",
    );
    const token = await tokenFor(app, USERS.technicianNicosia);
    const response = await request(app.getHttpServer())
      .get(`/assets/${rows[0].id}`)
      .set(bearer(token));
    const kinds = response.body.documents.map((d: { kind: string }) => d.kind).sort();
    expect(kinds).toEqual(["CERT", "COMMISSIONING"]);
  });

  // -------------------------------------------------------- the labels --

  it("prints a label whose payload opens the asset on a telephone", async () => {
    const first = await makeAsset();
    const second = await makeAsset();
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/assets/labels?ids=${second.id},${first.id}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    // In the order the caller asked for: a sheet is stuck on in that order.
    expect(response.body.map((label: { assetId: string }) => label.assetId)).toEqual([
      second.id,
      first.id,
    ]);
    expect(response.body[0].url).toBe(`http://localhost:3000/a/${second.tag}`);
    expect(response.body[0].tag).toBe(second.tag);
  });

  it("drops an id the caller may not see rather than telling them it exists", async () => {
    const mine = await makeAsset();
    const { rows } = await admin.query<{ id: string }>(
      "select id from ecapital.asset where org_unit_id = 'larnaca-general' limit 1",
    );
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get(`/assets/labels?ids=${mine.id},${rows[0].id}`)
      .set(bearer(token));
    expect(response.body).toHaveLength(1);
    expect(response.body[0].assetId).toBe(mine.id);
  });

  it("refuses a label sheet with nothing on it", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .get("/assets/labels?ids=")
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.assetLabelsNeedIds");
  });

  // ------------------------------------------------------ the forecast --

  it("sums the replacement estimates by unit and year and counts the critical ones", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/assets/replacement-forecast?from=2027&to=2035")
      .set(bearer(token));
    expect(response.status).toBe(200);
    expect(response.body.length).toBeGreaterThan(0);

    for (const row of response.body) {
      expect(row.year).toBeGreaterThanOrEqual(2027);
      expect(row.year).toBeLessThanOrEqual(2035);
      expect(row.assets).toBeGreaterThan(0);
      expect(row.criticalAssets).toBeLessThanOrEqual(row.assets);
      expect(typeof row.orgUnitNameEl).toBe("string");
    }

    const narrowed = await request(app.getHttpServer())
      .get("/assets/replacement-forecast?from=2027&to=2035&orgUnitId=larnaca-general")
      .set(bearer(token));
    expect(
      narrowed.body.every((row: { orgUnitId: string }) => row.orgUnitId === "larnaca-general"),
    ).toBe(true);
  });

  it("leaves a disposed asset out of the forecast, because nobody is replacing it", async () => {
    const token = await tokenFor(app, USERS.admin);
    const live = await makeAsset({ replacementYear: 2042, replacementCostEst: 1000 });
    const dead = await makeAsset({
      replacementYear: 2042,
      replacementCostEst: 9999,
      status: "DISPOSED",
    });
    expect(dead.id).toBeDefined();
    const response = await request(app.getHttpServer())
      .get("/assets/replacement-forecast?from=2042&to=2042&orgUnitId=nicosia-general")
      .set(bearer(token));
    expect(response.body).toHaveLength(1);
    expect(response.body[0].assets).toBe(1);
    expect(response.body[0].estimatedCost).toBe(1000);
    expect(live.id).toBeDefined();
  });

  it("refuses a year range that is the wrong way round", async () => {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get("/assets/replacement-forecast?from=2035&to=2027")
      .set(bearer(token));
    expect(response.status).toBe(400);
    expect(response.body.key).toBe("errors.assetForecastRangeNotValid");
  });

  it("shows a unit only the assets it may see in the forecast too", async () => {
    const token = await tokenFor(app, USERS.engineerLarnaca);
    const response = await request(app.getHttpServer())
      .get("/assets/replacement-forecast?from=2027&to=2035")
      .set(bearer(token));
    expect(response.body.length).toBeGreaterThan(0);
    expect(
      response.body.every((row: { orgUnitId: string }) => row.orgUnitId === "larnaca-general"),
    ).toBe(true);
  });
});
