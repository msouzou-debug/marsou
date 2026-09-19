import type { INestApplication } from "@nestjs/common";
import { ContractDetail, Variation } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * R10 — the variation workflow and the segregation of duties that runs
 * through it (CAPEX-01 §10). DRAFT → SUBMITTED → APPROVED, RETURNED or
 * REJECTED, with the approver never being the person who raised it, and the
 * contract's committed value following the approvals and nothing else (R13).
 *
 * The last two tests in the first block leave the API alone and talk to
 * Postgres directly, because the point of ADR-0015 is that the rules hold for
 * a code path that has not been written yet.
 */

const variationBody = {
  descriptionEl: "Πρόσθετες εργασίες στεγανοποίησης",
  reason: "SITE_CONDITION" as const,
  value: 20_000,
  timeImpactDays: 10,
};

describe("variations on a contract", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  /** A contract at Nicosia with a variation raised by the head of estates. */
  async function raised(
    stamp: string,
    body = variationBody,
  ): Promise<{ contractId: string; variation: Variation }> {
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(token))
      .send(body);
    expect(response.status).toBe(201);
    return { contractId: contract.id, variation: Variation.parse(response.body) };
  }

  it("starts in DRAFT, numbered 1, raised by whoever is signed in", async () => {
    const { variation } = await raised(`v1-${Date.now()}`);
    expect(variation.status).toBe("DRAFT");
    expect(variation.number).toBe(1);
    expect(variation.raisedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(variation.decidedById).toBeNull();
    expect(variation.decidedAt).toBeNull();
  });

  it("numbers them 1, 2, 3 on the contract", async () => {
    const stamp = `seq-${Date.now()}`;
    const { contractId } = await raised(stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    for (const expected of [2, 3]) {
      const next = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/variations`)
        .set(bearer(token))
        .send(variationBody);
      expect(next.status).toBe(201);
      expect(Variation.parse(next.body).number).toBe(expected);
    }

    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    // Newest first, which is the one people are looking for.
    expect(ContractDetail.parse(detail.body).variations.map((v) => v.number)).toEqual([3, 2, 1]);
  });

  it("hands two engineers raising one together two different numbers", async () => {
    // ADR-0015: the advisory lock is what turns a race into a queue.
    const stamp = `race-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/variations`)
        .set(bearer(token))
        .send({ ...variationBody, descriptionEl: "Ταυτόχρονη Α" }),
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/variations`)
        .set(bearer(token))
        .send({ ...variationBody, descriptionEl: "Ταυτόχρονη Β" }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const numbers = [first.body.number as number, second.body.number as number].sort();
    expect(numbers).toEqual([1, 2]);
  });

  it("lets the raiser change it in DRAFT and refuses everybody else", async () => {
    const { contractId, variation } = await raised(`edit-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const changed = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/variations/${variation.id}`)
      .set(bearer(estates))
      .send({ value: 25_000 });
    expect(changed.status).toBe(200);
    expect(Variation.parse(changed.body).value).toBe(25_000);

    // The clinical approver cannot write the register at all, and the row
    // policy says so before the raiser rule gets a look in.
    const clinical = await tokenFor(app, USERS.clinicalNicosia);
    const refused = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/variations/${variation.id}`)
      .set(bearer(clinical))
      .send({ value: 1 });
    expect(refused.status).toBe(403);
  });

  it("moves to SUBMITTED on the raiser's word and then stops being theirs to edit", async () => {
    const { contractId, variation } = await raised(`submit-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);

    const submitted = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/submit`)
      .set(bearer(estates));
    expect(submitted.status).toBe(200);
    expect(Variation.parse(submitted.body).status).toBe("SUBMITTED");

    const late = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/variations/${variation.id}`)
      .set(bearer(estates))
      .send({ value: 1 });
    expect(late.status).toBe(422);
    expect(late.body.key).toBe("errors.variationNotEditable");
  });

  it("refuses the approval of whoever raised it", async () => {
    // RULE (R10, CAPEX-01 §10). The head of estates may decide variations —
    // just not their own.
    const { contractId, variation } = await raised(`self-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/submit`)
      .set(bearer(estates));

    const response = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
      .set(bearer(estates))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(403);
    expect(response.body.key).toBe("errors.sameUserApproval");
  });

  it("refuses a decision from a role that does not take them", async () => {
    const { contractId, variation } = await raised(`role-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/submit`)
      .set(bearer(estates));

    // An engineer raises and submits; a head of estates or an administrator
    // decides. The clinical approver and the auditor decide nothing.
    for (const email of [USERS.clinicalNicosia, USERS.auditor, USERS.finance]) {
      const token = await tokenFor(app, email);
      const response = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
        .set(bearer(token))
        .send({ decision: "APPROVED", commentEl: null });
      expect(response.status).toBe(403);
    }
  });

  it("wants a comment before it sends one back or turns it down", async () => {
    const { contractId, variation } = await raised(`comment-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/submit`)
      .set(bearer(estates));

    const admin = await tokenFor(app, USERS.admin);
    for (const decision of ["RETURNED", "REJECTED"] as const) {
      const bare = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
        .set(bearer(admin))
        .send({ decision, commentEl: null });
      expect(bare.status).toBe(422);
      expect(bare.body.key).toBe("errors.commentRequired");

      const blank = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
        .set(bearer(admin))
        .send({ decision, commentEl: "   " });
      expect(blank.status).toBe(422);
    }

    const returned = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "RETURNED", commentEl: "Στείλτε αναλυτική προμέτρηση." });
    expect(returned.status).toBe(200);
    const after = Variation.parse(returned.body);
    expect(after.status).toBe("RETURNED");
    expect(after.decisionCommentEl).toBe("Στείλτε αναλυτική προμέτρηση.");
    expect(after.decidedByName).toBe("Μαρία Κωνσταντίνου");

    // Returned means it is the raiser's again.
    const edited = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/variations/${variation.id}`)
      .set(bearer(estates))
      .send({ value: 15_000 });
    expect(edited.status).toBe(200);
  });

  it("answers 404 when a head of estates from another unit tries to decide", async () => {
    // RULE (CAPEX-01 §10): the role is right and the unit is not, so the
    // contract does not exist for this caller. 404, not 403 — a 403 would
    // tell them a contract they may not see is there (ADR-0010).
    const stamp = `cross-${Date.now()}`;
    const { contract } = await makeContract(
      app,
      stamp,
      {},
      USERS.engineerLarnaca,
      "larnaca-general",
    );
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const created = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(engineer))
      .send(variationBody);
    expect(created.status).toBe(201);
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${created.body.id}/submit`)
      .set(bearer(engineer));

    const estates = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${created.body.id}/decide`)
      .set(bearer(estates))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.contractNotFound");
  });

  it("refuses a decision on one that is not waiting for one", async () => {
    const { contractId, variation } = await raised(`state-${Date.now()}`);
    const admin = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "APPROVED", commentEl: null });
    expect(response.status).toBe(422);
    expect(response.body.key).toBe("errors.variationNotSubmitted");
  });

  it("answers 404 for a variation that is not on this contract", async () => {
    const { contractId } = await raised(`stray-${Date.now()}`);
    const admin = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${crypto.randomUUID()}/submit`)
      .set(bearer(admin));
    expect(response.status).toBe(404);
    expect(response.body.key).toBe("errors.variationNotFound");
  });

  it("refuses a body that is not a variation or not a decision", async () => {
    const { contractId, variation } = await raised(`body-${Date.now()}`);
    const admin = await tokenFor(app, USERS.admin);
    const bad = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations`)
      .set(bearer(admin))
      .send({ ...variationBody, reason: "BECAUSE" });
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.variationNotValid");

    const badDecision = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/variations/${variation.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "MAYBE", commentEl: null });
    expect(badDecision.status).toBe(400);
    expect(badDecision.body.key).toBe("errors.variationDecisionNotValid");
  });
});

describe("the committed value follows the approvals", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function detailOf(id: string): Promise<ContractDetail> {
    const token = await tokenFor(app, USERS.admin);
    const response = await request(app.getHttpServer())
      .get(`/contracts/${id}`)
      .set(bearer(token));
    expect(response.status).toBe(200);
    return ContractDetail.parse(response.body);
  }

  it("moves on approval and on nothing else", async () => {
    // RULE (CAPEX-01 §7, R13): commitment = contract value + approved
    // variations. A draft, a submitted, a returned and a rejected variation
    // are proposals, and a proposal commits nothing.
    const stamp = `value-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const admin = await tokenFor(app, USERS.admin);

    const raise = async (value: number) => {
      const created = await request(app.getHttpServer())
        .post(`/contracts/${contract.id}/variations`)
        .set(bearer(estates))
        .send({ ...variationBody, value });
      return created.body.id as string;
    };
    const submit = (id: string) =>
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/variations/${id}/submit`)
        .set(bearer(estates));
    const decide = (id: string, decision: string, commentEl: string | null) =>
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/variations/${id}/decide`)
        .set(bearer(admin))
        .send({ decision, commentEl });

    const first = await raise(40_000);
    expect((await detailOf(contract.id)).currentValue).toBe(500_000);

    await submit(first);
    let now = await detailOf(contract.id);
    expect(now.currentValue).toBe(500_000);
    expect(now.pendingVariationsTotal).toBe(40_000);

    await decide(first, "APPROVED", null);
    now = await detailOf(contract.id);
    expect(now.currentValue).toBe(540_000);
    expect(now.approvedVariationsTotal).toBe(40_000);
    expect(now.pendingVariationsTotal).toBe(0);
    // 40.000 on 500.000 is 8% — under the mark, so no warning yet.
    expect(now.variationPctOfOriginal).toBeCloseTo(8, 5);
    expect(now.warnings.map((w) => w.key)).not.toContain("variationsOverTenPct");

    const rejected = await raise(100_000);
    await submit(rejected);
    await decide(rejected, "REJECTED", "Δεν προβλέπεται από τη σύμβαση.");
    expect((await detailOf(contract.id)).currentValue).toBe(540_000);

    const returned = await raise(30_000);
    await submit(returned);
    await decide(returned, "RETURNED", "Χρειάζεται αναλυτική προμέτρηση.");
    expect((await detailOf(contract.id)).currentValue).toBe(540_000);

    // An omission is a variation too, and it takes the commitment down.
    const omission = await raise(-15_000);
    await submit(omission);
    await decide(omission, "APPROVED", null);
    now = await detailOf(contract.id);
    expect(now.currentValue).toBe(525_000);
    expect(now.approvedVariationsTotal).toBe(25_000);
  });

  it("fires the ten per cent warning once the approvals pass the mark", async () => {
    // RULE (R31): it warns and flags; nothing is blocked and the variation is
    // approved all the same.
    const stamp = `warn-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const admin = await tokenFor(app, USERS.admin);

    const created = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(estates))
      .send({ ...variationBody, value: 75_000 });
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${created.body.id}/submit`)
      .set(bearer(estates));
    const approved = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${created.body.id}/decide`)
      .set(bearer(admin))
      .send({ decision: "APPROVED", commentEl: null });
    expect(approved.status).toBe(200);

    const now = await detailOf(contract.id);
    expect(now.currentValue).toBe(575_000);
    const warning = now.warnings.find((w) => w.key === "variationsOverTenPct");
    expect(warning).toBeDefined();
    // The amount is the excess over the mark, not the total: 75.000 − 50.000.
    expect(warning?.amount).toBe(25_000);
    expect(warning?.sentenceEl).toContain(contract.contractNo);
    expect(warning?.sentenceEn).toContain(contract.contractNo);
    expect(warning?.sentenceEl).not.toBe(warning?.sentenceEn);
  });
});

describe("the rules Postgres keeps on its own", () => {
  let app: INestApplication;
  let client: Client;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  it("refuses a direct update that makes the approver the raiser", async () => {
    // ADR-0015. The connection below is the migration role: it owns the
    // tables, so no policy applies to it. The CHECK still does, which is the
    // whole point — R10 is a property of the data, not of one service method.
    const stamp = `sql-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const created = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(estates))
      .send(variationBody);
    const id = created.body.id as string;

    await expect(
      client.query(
        `update ecapital.variation
            set status = 'APPROVED', decided_by = raised_by, decided_at = now()
          where id = $1`,
        [id],
      ),
    ).rejects.toMatchObject({ code: "23514", constraint: "variation_decider_not_raiser" });

    const still = await client.query<{ status: string }>(
      "select status from ecapital.variation where id = $1",
      [id],
    );
    expect(still.rows[0].status).toBe("DRAFT");
  });

  it("overwrites a current value somebody tries to type", async () => {
    // RULE (CAPEX-01 §7): the commitment is derived. The BEFORE trigger
    // recomputes it on the way in, so there is no way to write one.
    const stamp = `typed-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);

    await client.query("update ecapital.contract set current_value = 9999999 where id = $1", [
      contract.id,
    ]);
    const after = await client.query<{ current_value: string }>(
      "select current_value from ecapital.contract where id = $1",
      [contract.id],
    );
    expect(Number(after.rows[0].current_value)).toBe(500_000);
  });
});

describe("the audit trail of a variation", () => {
  let app: INestApplication;
  let client: Client;

  beforeAll(async () => {
    app = await createTestApp();
    client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL as string });
    await client.connect();
  });
  afterAll(async () => {
    await client.end();
    await app.close();
  });

  it("records the raising, the submission and the decision with the right actor", async () => {
    // R42: written by the trigger, inside the same transaction as the change,
    // with the actor taken from the request and not from a body field.
    const stamp = `audit-${Date.now()}`;
    const { contract } = await makeContract(app, stamp);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const admin = await tokenFor(app, USERS.admin);

    const created = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations`)
      .set(bearer(estates))
      .send(variationBody);
    const id = created.body.id as string;
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${id}/submit`)
      .set(bearer(estates));
    await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/variations/${id}/decide`)
      .set(bearer(admin))
      .send({ decision: "APPROVED", commentEl: "Εγκρίνεται." });

    const { rows } = await client.query<{
      action: string;
      actor_id: string;
      after: { status: string; decision_comment_el: string | null };
    }>(
      `select action, actor_id, after from ecapital.audit_log
        where entity_type = 'variation' and entity_id = $1 order by id`,
      [id],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].action).toBe("INSERT");
    expect(rows[0].actor_id).toBe("dev-estates-nicosia");
    expect(rows[0].after.status).toBe("DRAFT");
    expect(rows[1].actor_id).toBe("dev-estates-nicosia");
    expect(rows[1].after.status).toBe("SUBMITTED");
    expect(rows[2].actor_id).toBe("dev-admin");
    expect(rows[2].after.status).toBe("APPROVED");
    expect(rows[2].after.decision_comment_el).toBe("Εγκρίνεται.");

    // And the contract itself has a line for the value the approval moved.
    const contractRows = await client.query<{ action: string }>(
      `select action from ecapital.audit_log
        where entity_type = 'contract' and entity_id = $1 order by id`,
      [contract.id],
    );
    expect(contractRows.rows.map((r) => r.action)).toContain("UPDATE");
  });
});
