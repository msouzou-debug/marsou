import type { INestApplication } from "@nestjs/common";
import { ContractDetail } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * ADR-0035 §4, 0029 — the papers of a claim. A claim arrives as a letter or
 * an e-mail, is answered, and often brings a lawyer's letter after it; each
 * is filed with eArchive like every other paper (ADR-0023) and listed on the
 * claim.
 */
const PDF = Buffer.from("%PDF-1.7\nΕπιστολή αξίωσης δοκιμής\n%%EOF\n", "utf8");
const EML = Buffer.from("From: anadoxos@example.test\nSubject: Αξίωση\n\nΔοκιμή\n", "utf8");

describe("a claim's papers", () => {
  let app: INestApplication;
  let db: Client;
  const http = () => request(app.getHttpServer());
  const made: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    db = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await db.connect();
  });
  afterAll(async () => {
    if (made.length) await db.query("delete from ecapital.contract where id = any($1::uuid[])", [made]);
    await db.end();
    await app.close();
  });

  async function claimOn(direction: "BY_CONTRACTOR" | "BY_ORGANISATION") {
    const created = await makeContract(app, `claim-doc-${Date.now()}`);
    made.push(created.contract.id);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const added = await http()
      .post(`/contracts/${created.contract.id}/claims`)
      .set(bearer(token))
      .send({
        direction,
        titleEl: "Αξίωση για πρόσθετο κόστος",
        amount: 125_000,
        stage: "NOTIFIED",
        notifiedAt: "2026-10-05",
        legalAdvisorEl: null,
        contingentLiability: false,
        notesEl: "",
      });
    expect(added.status).toBe(201);
    const claim = ContractDetail.parse(added.body).claims![0];
    return { contract: created.contract, claim };
  }

  async function file(
    contractId: string,
    claimId: string,
    kind: string | null,
    email: string = USERS.estatesNicosia,
    bytes: Buffer = PDF,
    filename = "epistoli.pdf",
    contentType = "application/pdf",
  ) {
    const token = await tokenFor(app, email);
    const call = http()
      .post(`/contracts/${contractId}/claims/${claimId}/documents`)
      .set(bearer(token));
    if (kind !== null) call.field("kind", kind);
    return call.attach("file", bytes, { filename, contentType });
  }

  it("files the letter, the reply and a lawyer's letter, and lists all three on the claim", async () => {
    const { contract, claim } = await claimOn("BY_CONTRACTOR");

    const letter = await file(contract.id, claim.id, "CLAIM_LETTER", USERS.estatesNicosia, EML, "email.eml", "message/rfc822");
    expect(letter.status).toBe(201);
    expect(letter.body).toMatchObject({
      entityType: "contract_claim",
      entityId: claim.id,
      kind: "CLAIM_LETTER",
      outboxStatus: "QUEUED",
    });
    expect((await file(contract.id, claim.id, "CLAIM_REPLY")).status).toBe(201);
    expect((await file(contract.id, claim.id, "CLAIM_LEGAL_LETTER")).status).toBe(201);

    const token = await tokenFor(app, USERS.estatesNicosia);
    const detail = ContractDetail.parse((await http().get(`/contracts/${contract.id}`).set(bearer(token))).body);
    const papers = detail.claims!.find((c) => c.id === claim.id)!.documents;
    expect(papers.map((p) => p.kind)).toEqual(["CLAIM_LETTER", "CLAIM_REPLY", "CLAIM_LEGAL_LETTER"]);
    expect(papers[0]).toMatchObject({ mime: "message/rfc822", protocolNumber: null });

    // The bytes open through the same route as every other paper.
    const content = await http().get(`/documents/${papers[1].documentId}/content`).set(bearer(token));
    expect(content.status).toBe(200);
    expect(content.headers["content-type"]).toBe("application/pdf");
  });

  it("queues each paper for eArchive under its own reference, the contractor's letters as incoming", async () => {
    const { contract, claim } = await claimOn("BY_CONTRACTOR");
    await file(contract.id, claim.id, "CLAIM_LETTER");
    await file(contract.id, claim.id, "CLAIM_REPLY");
    await file(contract.id, claim.id, "CLAIM_LEGAL_LETTER");

    const { rows } = await db.query<{ source_ref: string; source_module: string; meta: Record<string, unknown> }>(
      "select source_ref, source_module, meta from ecapital.dms_outbox where source_ref like $1 order by source_ref",
      [`claim_doc:${claim.id}:%`],
    );
    expect(rows.map((r) => r.source_ref)).toEqual([1, 2, 3].map((n) => `claim_doc:${claim.id}:${n}`));
    expect(rows.every((r) => r.source_module === "claim_document")).toBe(true);
    const [letter, reply, legal] = rows.map((r) => r.meta);
    // The contractor wrote the claim and the lawyer's letter; the reply is ours.
    expect(letter).toMatchObject({ direction: "IN", doc_type: "Επιστολή αξίωσης", letter_date: "2026-10-05" });
    expect(letter.sender_name).not.toBe("Τεχνικές Υπηρεσίες ΟΚΥπΥ");
    expect(reply).toMatchObject({ direction: "INTERNAL", sender_name: "Τεχνικές Υπηρεσίες ΟΚΥπΥ" });
    expect(legal).toMatchObject({ direction: "IN", category: "Νομικά" });
    expect(letter.related).toEqual([{ source_ref: `award:${contract.id}`, relation: "RELATED" }]);
  });

  it("turns the direction round for a claim by the Organisation", async () => {
    const { contract, claim } = await claimOn("BY_ORGANISATION");
    await file(contract.id, claim.id, "CLAIM_LETTER");
    await file(contract.id, claim.id, "CLAIM_REPLY");
    const { rows } = await db.query<{ meta: { direction: string } }>(
      "select meta from ecapital.dms_outbox where source_ref like $1 order by source_ref",
      [`claim_doc:${claim.id}:%`],
    );
    expect(rows.map((r) => r.meta.direction)).toEqual(["INTERNAL", "IN"]);
  });

  it("needs a kind, a claim on that contract, and a role that writes contract records", async () => {
    const { contract, claim } = await claimOn("BY_CONTRACTOR");

    const noKind = await file(contract.id, claim.id, null);
    expect(noKind.status).toBe(400);
    expect(noKind.body.key).toBe("errors.claimDocumentKindNeeded");
    const badKind = await file(contract.id, claim.id, "AWARD_DECISION");
    expect(badKind.status).toBe(400);

    const other = await makeContract(app, `claim-doc-other-${Date.now()}`);
    made.push(other.contract.id);
    const elsewhere = await file(other.contract.id, claim.id, "CLAIM_LETTER");
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body.key).toBe("errors.claimNotFound");

    expect((await file(contract.id, claim.id, "CLAIM_LETTER", USERS.finance)).status).toBe(403);
    expect((await file(contract.id, claim.id, "CLAIM_LETTER", USERS.auditor)).status).toBe(403);
    // Larnaca's engineer cannot see a Nicosia claim at all.
    expect([403, 404]).toContain((await file(contract.id, claim.id, "CLAIM_LETTER", USERS.engineerLarnaca)).status);
  });
});
