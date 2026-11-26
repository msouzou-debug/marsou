import type { INestApplication } from "@nestjs/common";
import {
  ContractDetail,
  SiteInstruction,
  SiteInstructionDocument,
  Variation,
  nicosiaDateOf,
} from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";
import { binary } from "./maintenance-support";

/**
 * R09 — the site instruction log, and the one rule that hangs off it: an
 * instruction that costs money has to end up as a variation (CAPEX-01 §4).
 * Warn and flag, never block — the instruction stands either way, and the
 * contract screen counts the ones nobody has priced (R31).
 */
const plain = {
  textEl: "Μεταφέρετε τον χώρο φύλαξης υλικών στον βόρειο περιβάλλοντα χώρο.",
  costImpactFlag: false,
};
const costly = {
  textEl: "Προσθέστε δεύτερη σειρά ηχομονωτικών πάνελ στον θάλαμο μηχανημάτων.",
  costImpactFlag: true,
};

describe("site instructions on a contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function issued(
    stamp: string,
    body: Record<string, unknown> = plain,
  ): Promise<{ contractId: string; instruction: SiteInstruction }> {
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send(body);
    expect(response.status).toBe(201);
    return { contractId: contract.id, instruction: SiteInstruction.parse(response.body) };
  }

  it("is numbered 1, issued by the caller, with no variation behind it", async () => {
    const { instruction } = await issued(`si-${Date.now()}`);
    expect(instruction.number).toBe(1);
    expect(instruction.issuedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(instruction.costImpactFlag).toBe(false);
    expect(instruction.variationId).toBeNull();
  });

  it("numbers them per contract and lists them newest first", async () => {
    const { contractId } = await issued(`si-seq-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const second = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions`)
      .set(bearer(token))
      .send(costly);
    expect(SiteInstruction.parse(second.body).number).toBe(2);

    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect(list.body.map((i: SiteInstruction) => i.number)).toEqual([2, 1]);
  });

  it("refuses a body with no text", async () => {
    const { contract } = await makeContract(app, `si-bad-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ costImpactFlag: true });
    expect(refused.status).toBe(400);
    expect(refused.body.key).toBe("errors.siteInstructionNotValid");
  });

  // ------------------------------------------------------------- the variation --

  it("turns a cost-impact instruction into a DRAFT variation and links the two", async () => {
    const { contractId, instruction } = await issued(`si-var-${Date.now()}`, costly);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));
    expect(created.status).toBe(201);

    const variation = Variation.parse(created.body);
    expect(variation.status).toBe("DRAFT");
    expect(variation.reason).toBe("CLIENT_CHANGE");
    // The instruction's own words, and a value for the engineer to fill in.
    expect(variation.descriptionEl).toBe(costly.textEl);
    expect(variation.value).toBe(0);
    expect(variation.raisedByName).toBe("Ανδρέας Παπαδόπουλος");

    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions`)
      .set(bearer(token));
    expect(SiteInstruction.parse(list.body[0]).variationId).toBe(variation.id);

    // A DRAFT commits nothing (CAPEX-01 §7): the contract's value is untouched.
    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    const parsed = ContractDetail.parse(detail.body);
    expect(parsed.currentValue).toBe(parsed.originalValue);
  });

  it("refuses an instruction with no cost impact", async () => {
    const { contractId, instruction } = await issued(`si-nocost-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.noCostImpact");
  });

  it("refuses a second variation from the same instruction", async () => {
    const { contractId, instruction } = await issued(`si-twice-${Date.now()}`, costly);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const first = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));
    expect(second.status).toBe(422);
    expect(second.body.key).toBe("errors.alreadyLinked");
  });

  // ---------------------------------------------------------------- the warning --

  it("warns about cost-impact instructions nobody has priced, and stops once they are", async () => {
    const { contractId, instruction } = await issued(`si-warn-${Date.now()}`, costly);
    const token = await tokenFor(app, USERS.estatesNicosia);

    const before = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    const warning = ContractDetail.parse(before.body).warnings.find(
      (w) => w.key === "instructionsWithoutVariation",
    );
    expect(warning).toBeDefined();
    expect(warning?.sentenceEl).toContain("1");
    expect(warning?.sentenceEn).not.toBe(warning?.sentenceEl);
    expect(warning?.amount).toBeNull();

    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));

    const after = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    expect(
      ContractDetail.parse(after.body).warnings.some(
        (w) => w.key === "instructionsWithoutVariation",
      ),
    ).toBe(false);
  });

  it("says nothing about an instruction that costs nothing", async () => {
    const { contractId } = await issued(`si-quiet-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    expect(
      ContractDetail.parse(detail.body).warnings.some(
        (w) => w.key === "instructionsWithoutVariation",
      ),
    ).toBe(false);
  });

  // ------------------------------------------------------------------- access --

  it("hides another unit's instructions behind a 404", async () => {
    const { contractId, instruction } = await issued(`si-rls-${Date.now()}`, costly);
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions`)
      .set(bearer(larnaca));
    expect(list.status).toBe(404);

    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(larnaca));
    expect(refused.status).toBe(404);
  });

  it("refuses the auditor and the executive a write and lets them read", async () => {
    const { contractId } = await issued(`si-ro-${Date.now()}`);
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const read = await request(app.getHttpServer())
        .get(`/contracts/${contractId}/site-instructions`)
        .set(bearer(token));
      expect(read.status).toBe(200);
      const refused = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/site-instructions`)
        .set(bearer(token))
        .send(plain);
      expect(refused.status).toBe(403);
      expect(refused.body.key).toBe("errors.readOnlyAccount");
    }
  });

  it("writes an audit row with the actor for the instruction and its variation", async () => {
    // R42.
    const { contractId, instruction } = await issued(`si-audit-${Date.now()}`, costly);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(estates));

    const auditor = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "site_instruction", entity_id: instruction.id })
      .set(bearer(auditor));
    expect(log.status).toBe(200);
    // The instruction going in, and the link to the variation going on.
    expect(log.body.map((e: { action: string }) => e.action).sort()).toEqual([
      "INSERT",
      "UPDATE",
    ]);
    for (const entry of log.body) expect(entry.actorId).toBe("dev-estates-nicosia");
  });

  // ---------------------------------------------- editing one (UAT 25/11/2026) --

  function daysAgo(days: number): string {
    const date = new Date(`${nicosiaDateOf(new Date())}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
  }

  it("records the day an instruction was given, and refuses a day after today", async () => {
    const { contract } = await makeContract(app, `si-day-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const given = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, issuedOn: daysAgo(3) });
    expect(given.status).toBe(201);
    expect(nicosiaDateOf(SiteInstruction.parse(given.body).issuedAt)).toBe(daysAgo(3));

    const future = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, issuedOn: daysAgo(-1) });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");
  });

  it("corrects the text, the cost impact and the issue day, and the audit trail keeps it", async () => {
    const { contractId, instruction } = await issued(`si-edit-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const edited = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(token))
      .send({ textEl: "Μεταφέρετε τα υλικά στον νότιο χώρο.", costImpactFlag: true, issuedOn: daysAgo(2) });
    expect(edited.status).toBe(200);
    const after = SiteInstruction.parse(edited.body);
    expect(after.textEl).toBe("Μεταφέρετε τα υλικά στον νότιο χώρο.");
    expect(after.costImpactFlag).toBe(true);
    expect(nicosiaDateOf(after.issuedAt)).toBe(daysAgo(2));
    expect(after.issuedByName).toBe(instruction.issuedByName);
    expect(after.number).toBe(instruction.number);

    const future = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(token))
      .send({ issuedOn: daysAgo(-1) });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");

    const auditor = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "site_instruction", entity_id: instruction.id })
      .set(bearer(auditor));
    expect(log.body.map((e: { action: string }) => e.action).sort()).toEqual(["INSERT", "UPDATE"]);
  });

  it("refuses to edit an instruction once it has become a variation", async () => {
    const { contractId, instruction } = await issued(`si-edit-settled-${Date.now()}`, costly);
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/variation`)
      .set(bearer(token));
    const refused = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(token))
      .send({ textEl: "Αργά πια." });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.siteInstructionSettled");
  });

  it("refuses a bad body, a read-only account, and another unit", async () => {
    const { contractId, instruction } = await issued(`si-edit-rls-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const empty = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(estates))
      .send({ textEl: "" });
    expect(empty.status).toBe(400);
    expect(empty.body.key).toBe("errors.siteInstructionNotValid");

    const auditor = await tokenFor(app, USERS.auditor);
    const refused = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(auditor))
      .send({ textEl: "Δεν θα έπρεπε να περάσει." });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.readOnlyAccount");

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const hidden = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/site-instructions/${instruction.id}`)
      .set(bearer(larnaca))
      .send({ textEl: "Δεν θα έπρεπε να περάσει." });
    expect(hidden.status).toBe(404);
  });

  // ------------------------------- the e-mail facility (owner, 26/11/2026) --

  it("records who it was sent to, the address and the day it left, and corrects or clears them", async () => {
    const { contract } = await makeContract(app, `si-mail-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const today = nicosiaDateOf(new Date());
    const created = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({
        ...plain,
        recipientName: "  Μάριος Ανδρέου, Δοκιμαστική Εργοληπτική  ",
        recipientEmail: "m.andreou@contractor.example",
        sentOn: today,
      });
    expect(created.status).toBe(201);
    const instruction = SiteInstruction.parse(created.body);
    expect(instruction.recipientName).toBe("Μάριος Ανδρέου, Δοκιμαστική Εργοληπτική");
    expect(instruction.recipientEmail).toBe("m.andreou@contractor.example");
    expect(instruction.sentOn).toBe(today);

    // Without them, as before 0034: nothing is required.
    const bare = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send(plain);
    expect(bare.status).toBe(201);
    expect(SiteInstruction.parse(bare.body).recipientName).toBeNull();
    expect(SiteInstruction.parse(bare.body).sentOn).toBeNull();

    const edited = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}/site-instructions/${instruction.id}`)
      .set(bearer(token))
      .send({ recipientName: "Ελένη Χαραλάμπους", recipientEmail: null, sentOn: null });
    expect(edited.status).toBe(200);
    const after = SiteInstruction.parse(edited.body);
    expect(after.recipientName).toBe("Ελένη Χαραλάμπους");
    expect(after.recipientEmail).toBeNull();
    expect(after.sentOn).toBeNull();
    // The rest of it is untouched by a PATCH that does not name it.
    expect(after.textEl).toBe(plain.textEl);

    const list = await request(app.getHttpServer())
      .get(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token));
    const listed = (list.body as unknown[]).map((i) => SiteInstruction.parse(i));
    expect(listed.find((i) => i.id === instruction.id)?.recipientName).toBe("Ελένη Χαραλάμπους");
  });

  it("refuses a sent day after today, before the issue day, and a bad address", async () => {
    const { contract } = await makeContract(app, `si-mail-bad-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const future = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, sentOn: daysAgo(-1) });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");

    const early = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, issuedOn: daysAgo(1), sentOn: daysAgo(3) });
    expect(early.status).toBe(422);
    expect(early.body.key).toBe("errors.siteInstructionSentBeforeIssued");

    const address = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, recipientEmail: "not an address" });
    expect(address.status).toBe(400);
    expect(address.body.key).toBe("errors.siteInstructionRecipientEmailNotValid");

    // Given three days ago and sent two days ago is fine; moving the issue
    // day after the sent day, or the sent day before the issue day, is not.
    const ok = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/site-instructions`)
      .set(bearer(token))
      .send({ ...plain, issuedOn: daysAgo(3), sentOn: daysAgo(2) });
    expect(ok.status).toBe(201);
    const moved = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}/site-instructions/${ok.body.id}`)
      .set(bearer(token))
      .send({ issuedOn: daysAgo(1) });
    expect(moved.status).toBe(422);
    expect(moved.body.key).toBe("errors.siteInstructionSentBeforeIssued");
    const backwards = await request(app.getHttpServer())
      .patch(`/contracts/${contract.id}/site-instructions/${ok.body.id}`)
      .set(bearer(token))
      .send({ sentOn: daysAgo(4) });
    expect(backwards.status).toBe(422);
    expect(backwards.body.key).toBe("errors.siteInstructionSentBeforeIssued");
  });

  const EML = Buffer.from("To: a@b.example\r\nSubject: SI 1\r\nX-Unsent: 1\r\n\r\nΟδηγία.\r\n", "utf8");

  it("files the sent .eml and a PDF letter, queued for eArchive under their own module, listed and readable", async () => {
    const { contractId, instruction } = await issued(`si-evidence-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const sent = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(token))
      .field("titleEl", "Επιστολή οδηγίας — SI-1.eml")
      .attach("file", EML, { filename: "SI-1.eml", contentType: "application/octet-stream" });
    expect(sent.status).toBe(201);
    const sentDoc = SiteInstructionDocument.parse(sent.body);
    expect(sentDoc.mime).toBe("message/rfc822");
    expect(sentDoc.titleEl).toBe("Επιστολή οδηγίας — SI-1.eml");
    expect(sentDoc.uploadedByName).toBe("Ανδρέας Παπαδόπουλος");

    const letter = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(token))
      .attach("file", Buffer.from("%PDF-1.7\n%%EOF\n"), {
        filename: "Επιστολή προς ανάδοχο.pdf",
        contentType: "application/pdf",
      });
    // A Greek name with spaces is filed, and kept as it was written (multer
    // reads it as UTF-8; the name on disk is ASCII).
    expect(letter.status).toBe(201);
    expect(SiteInstructionDocument.parse(letter.body).filename).toBe("Επιστολή προς ανάδοχο.pdf");

    const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
    try {
      const { rows } = await client.query<{ source_module: string; source_ref: string; kind: string }>(
        `select o.source_module, o.source_ref, d.kind::text as kind
           from ecapital.document d join ecapital.dms_outbox o on o.document_id = d.id
          where d.entity_type = 'site_instruction' and d.entity_id = $1 order by d.version`,
        [instruction.id],
      );
      expect(rows.map((r) => r.source_ref)).toEqual([
        `site_instruction_doc:${instruction.id}:1`,
        `site_instruction_doc:${instruction.id}:2`,
      ]);
      expect(
        rows.every(
          (r) => r.source_module === "site_instruction_document" && r.kind === "SITE_INSTRUCTION_EVIDENCE",
        ),
      ).toBe(true);
    } finally {
      await client.end();
    }

    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    expect((list.body as unknown[]).map((d) => SiteInstructionDocument.parse(d).id).sort()).toEqual(
      [sentDoc.id, letter.body.id].sort(),
    );

    const content = await request(app.getHttpServer())
      .get(`/documents/${sentDoc.id}/content?download=1`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(content.status).toBe(200);
    expect(Buffer.from(content.body as Buffer).equals(EML)).toBe(true);

    const none = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(token))
      .field("titleEl", "Χωρίς αρχείο");
    expect(none.status).toBe(400);
    expect(none.body.key).toBe("errors.documentNeeded");
  });

  it("hides another unit's correspondence, and refuses the auditor and a role that only reads instructions", async () => {
    const { contractId, instruction } = await issued(`si-evidence-rls-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(estates))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(filed.status).toBe(201);

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const hiddenList = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(larnaca));
    expect(hiddenList.status).toBe(404);
    const hiddenUpload = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(larnaca))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(hiddenUpload.status).toBe(404);
    const hiddenContent = await request(app.getHttpServer())
      .get(`/documents/${filed.body.id}/content`)
      .set(bearer(larnaca));
    expect(hiddenContent.status).toBe(404);

    const auditor = await tokenFor(app, USERS.auditor);
    const read = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(auditor));
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(auditor))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(refused.status).toBe(403);

    const finance = await tokenFor(app, USERS.finance);
    const financeRefused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/site-instructions/${instruction.id}/documents`)
      .set(bearer(finance))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(financeRefused.status).toBe(403);
  });
});
