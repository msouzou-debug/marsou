import type { INestApplication } from "@nestjs/common";
import { ContractDetail, SiteInstruction, Variation } from "@ecapital/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

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
    body = plain,
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
});
