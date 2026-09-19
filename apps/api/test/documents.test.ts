import { createHash } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract, projectAt } from "./contract-support";

/**
 * M8, the eArchive outbox (ADR-0023).
 *
 * The rule this suite exists for is the first one in the ADR: the `document`
 * row and the `dms_outbox` row are written in the same transaction. Every
 * test below is an aspect of that, or of the metadata the queue row carries,
 * or of who is allowed to put one there.
 *
 * The queue is service-only, so the assertions about it go to Postgres
 * directly rather than through a route a unit-scoped account could use — that
 * is the point of the policy.
 */
const PDF = Buffer.from("%PDF-1.7\nΔοκιμαστικό έγγραφο\n%%EOF\n", "utf8");

describe("filing documents with eArchive", () => {
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

  async function outboxRow(sourceRef: string) {
    const { rows } = await admin.query<{
      id: string;
      source_module: string;
      status: string;
      attempts: number;
      meta: Record<string, unknown>;
      files: Record<string, unknown>[];
      document_id: string;
      org_unit_id: string;
    }>("select * from ecapital.dms_outbox where source_ref = $1", [sourceRef]);
    return rows[0];
  }

  async function fileAward(stamp: string, email: string = USERS.admin) {
    const { contract, project } = await makeContract(app, stamp);
    const token = await tokenFor(app, email);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    return { response, contract, project };
  }

  /**
   * RULE (ADR-0023): one transaction. The document row and the queue row are
   * both there afterwards, and the queue row points at the document.
   */
  it("writes the document and the queue entry together", async () => {
    const { response, contract } = await fileAward(`doc-${Date.now()}`);
    expect(response.status).toBe(201);
    expect(response.body.kind).toBe("AWARD_DECISION");
    expect(response.body.outboxStatus).toBe("QUEUED");
    // eCapital never invents a protocol number; it arrives from eArchive.
    expect(response.body.protocolId).toBeNull();
    expect(response.body.protocolNumber).toBeNull();
    expect(response.body.sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
    expect(response.body.size).toBe(PDF.length);

    const queued = await outboxRow(`award:${contract.id}`);
    expect(queued).toBeDefined();
    expect(queued.source_module).toBe("award");
    expect(queued.status).toBe("QUEUED");
    expect(queued.attempts).toBe(0);
    expect(queued.document_id).toBe(response.body.id);
    expect(queued.org_unit_id).toBe("nicosia-general");
  });

  it("builds the meta the brief describes, with the unit's own code", async () => {
    const stamp = `meta-${Date.now()}`;
    const { response, contract, project } = await fileAward(stamp);
    expect(response.status).toBe(201);
    const queued = await outboxRow(`award:${contract.id}`);
    const meta = queued.meta as Record<string, unknown>;

    expect(meta.schema_version).toBe(1);
    expect(meta.source_system).toBe("eCapital");
    expect(meta.registry_hint).toBe("ΤΥ");
    expect(meta.retention_class_hint).toBe("rc-capital");
    expect(meta.category).toBe("Συμβάσεις");
    expect(meta.classification).toBe("BUSINESS");
    expect(meta.direction).toBe("INTERNAL");
    expect(meta.personal_data).toBe(false);
    expect(meta.currency).toBe("EUR");
    expect(meta.amount).toBe(500_000);
    // ADR-0024: eArchive's site code is `org_unit.code`, nothing in between.
    expect(meta.folder_hints).toEqual([
      { hospital: "NGH", title: "Γενικό Νοσοκομείο Λευκωσίας" },
    ]);
    expect(String(meta.subject)).toContain(project.titleEl);
    expect(String(meta.subject)).toContain("500.000,00 €");
    expect(String(meta.source_url)).toContain(`/contracts/${contract.id}`);
    // `outbox_id` and `sent_at` belong to the sending, not to the queueing.
    expect(meta.outbox_id).toBeUndefined();
    expect(meta.sent_at).toBeUndefined();

    // The files list is what the sender needs: the object key plus everything
    // `meta.files[]` promised, agreeing field for field.
    const files = queued.files;
    expect(files).toHaveLength(1);
    expect(files[0].kind).toBe("MAIN");
    expect(files[0].part_name).toBe("file_main");
    expect(String(files[0].object_key)).toMatch(/^award\//);
    expect(files[0].sha256).toBe(response.body.sha256);
    const metaFiles = meta.files as Record<string, unknown>[];
    expect(metaFiles[0].object_key).toBeUndefined();
    expect(metaFiles[0].sha256).toBe(response.body.sha256);
  });

  /**
   * RULE (eArchive brief): a corrected document is a NEW item with a NEW
   * source_ref and a SUPERSEDES relation, never an edit of one already
   * protocolled.
   */
  it("files a correction as a new item that supersedes the first", async () => {
    const stamp = `corr-${Date.now()}`;
    const { contract } = await fileAward(stamp);
    const token = await tokenFor(app, USERS.admin);
    const second = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi-diorthomeni.pdf", contentType: "application/pdf" });
    expect(second.status).toBe(201);
    expect(second.body.version).toBe(2);
    expect(second.body.sourceRef).toBe(`award:${contract.id}:v2`);

    const queued = await outboxRow(`award:${contract.id}:v2`);
    expect(queued.meta.related).toEqual([
      { source_ref: `award:${contract.id}`, relation: "SUPERSEDES" },
    ]);

    // Both are in the list, newest version first, and the first is untouched.
    const listed = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}/documents`)
      .set(bearer(token));
    expect(listed.status).toBe(200);
    expect(listed.body.map((d: { version: number }) => d.version)).toEqual([2, 1]);
  });

  it("files a project's business case under Διοίκηση", async () => {
    const project = await projectAt(app, "APPROVED", `Μελέτη δοκιμής ${Date.now()}`);
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/projects/${project.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "meleti.pdf", contentType: "application/pdf" });
    expect(response.status).toBe(201);
    expect(response.body.kind).toBe("BUSINESS_CASE");

    const queued = await outboxRow(`business_case:${project.code}`);
    expect(queued.source_module).toBe("business_case");
    expect(queued.meta.category).toBe("Διοίκηση");
    expect(queued.meta.counterparties).toEqual([]);
  });

  /**
   * RULE (eArchive brief, R10): the registry gets the decision, not the
   * working paper. A variation that is not approved is refused.
   */
  it("refuses a variation that has not been approved", async () => {
    const stamp = `var-draft-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const raised = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(estates))
      .send({
        descriptionEl: "Πρόσθετες εργασίες στεγανοποίησης",
        reason: "SITE_CONDITION",
        value: 20_000,
        timeImpactDays: 10,
      });
    expect(raised.status).toBe(201);

    const refused = await request(app.getHttpServer())
      .post(`/variations/${raised.body.id}/documents`)
      .set(bearer(estates))
      .attach("file", PDF, { filename: "tropopoiisi.pdf", contentType: "application/pdf" });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.variationNotApproved");
  });

  it("files an approved variation and relates it back to the award", async () => {
    const stamp = `var-ok-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const admin_ = await tokenFor(app, USERS.admin);

    const raised = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(estates))
      .send({
        descriptionEl: "Πρόσθετες εργασίες στεγανοποίησης",
        reason: "SITE_CONDITION",
        value: 20_000,
        timeImpactDays: 10,
      });
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${raised.body.id}/submit`)
      .set(bearer(estates));
    const decided = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${raised.body.id}/decide`)
      .set(bearer(admin_))
      .send({ decision: "APPROVED", commentEl: "Εγκρίνεται εντός του αποθεματικού." });
    expect(decided.status).toBe(200);

    const filed = await request(app.getHttpServer())
      .post(`/variations/${raised.body.id}/documents`)
      .set(bearer(admin_))
      .attach("file", PDF, { filename: "tropopoiisi.pdf", contentType: "application/pdf" });
    expect(filed.status).toBe(201);
    expect(filed.body.kind).toBe("VARIATION");

    const queued = await outboxRow(`variation:${contract.ref}:1`);
    expect(queued.meta.related).toEqual([
      { source_ref: `award:${contract.id}`, relation: "RELATED" },
    ]);
    // R10's two people, by name, off the variation's own columns.
    const approvals = queued.meta.approvals as { action: string }[];
    expect(approvals.map((a) => a.action)).toEqual(["Υποβολή", "Έγκριση"]);
  });

  // The whitelist is enforced before a byte is written, not at send time.
  it("refuses a file type eArchive does not accept", async () => {
    const { contract } = await makeContract(app, `mime-${Date.now()}`);
    const token = await tokenFor(app, USERS.admin);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", Buffer.from("PK\u0003\u0004"), {
        filename: "sxedia.zip",
        contentType: "application/zip",
      });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.documentMimeRejected");
    expect(await outboxRow(`award:${contract.id}`)).toBeUndefined();
  });

  it("refuses a request with no file at all", async () => {
    const { contract } = await makeContract(app, `nofile-${Date.now()}`);
    const token = await tokenFor(app, USERS.admin);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token));
    expect(refused.status).toBe(400);
    expect(refused.body.key).toBe("errors.documentNeeded");
  });

  /** CAPEX-01 §10: the two read-only roles see everything and write nothing. */
  it("refuses a read-only account", async () => {
    const { contract } = await makeContract(app, `ro-${Date.now()}`);
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const refused = await request(app.getHttpServer())
        .post(`/contracts/${contract.id}/documents`)
        .set(bearer(token))
        .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
      expect(refused.status, email).toBe(403);
    }
  });

  /** ADR-0010: a contract in a unit the caller may not see does not exist. */
  it("answers 404 for a contract in another unit", async () => {
    const { contract } = await makeContract(app, `other-${Date.now()}`);
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(larnaca))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    expect(refused.status).toBe(404);
  });

  /** R42: every mutation, including this one. */
  it("audits the document row", async () => {
    const { response } = await fileAward(`audit-${Date.now()}`);
    const { rows } = await admin.query<{ action: string; org_unit_id: string }>(
      "select action, org_unit_id from ecapital.audit_log where entity_type = 'document' and entity_id = $1",
      [response.body.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("INSERT");
    expect(rows[0].org_unit_id).toBe("nicosia-general");
  });
});
