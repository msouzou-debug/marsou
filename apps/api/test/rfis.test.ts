import type { INestApplication } from "@nestjs/common";
import { ContractDetail, Rfi } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * R09 — the RFI log and its SLA clock. Αίτημα διευκρίνισης.
 *
 * The band tests go round the API to move `sla_due_at` directly in Postgres,
 * because the only way to put a real RFI at 51% of its window is to say where
 * its window ends. What they assert is the same function
 * `src/rfis/rfi-rows.test.ts` pins, coming back through the HTTP layer.
 */
const question = { questionEl: "Ποιο πρότυπο ισχύει για τα πυράντοχα κουφώματα;" };

describe("RFIs on a contract", () => {
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

  async function raised(
    stamp: string,
    body: Record<string, unknown> = question,
  ): Promise<{ contractId: string; rfi: Rfi }> {
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const response = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/rfis`)
      .set(bearer(token))
      .send(body);
    expect(response.status).toBe(201);
    return { contractId: contract.id, rfi: Rfi.parse(response.body) };
  }

  /** Put an RFI's due moment exactly where the test needs it. */
  async function setDue(rfiId: string, hoursFromNow: number, slaHours: number): Promise<void> {
    await client.query(
      `update ecapital.rfi
          set sla_due_at = now() + make_interval(secs => $2), sla_hours = $3
        where id = $1`,
      [rfiId, hoursFromNow * 3600, slaHours],
    );
  }

  async function bandOf(contractId: string, rfiId: string): Promise<Rfi["slaState"]> {
    const token = await tokenFor(app, USERS.estatesNicosia);
    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    const found = list.body.find((r: Rfi) => r.id === rfiId);
    return Rfi.parse(found).slaState;
  }

  // ------------------------------------------------------------- the happy path --

  it("starts OPEN, numbered 1, raised by the caller, with the SLA clock set", async () => {
    const { rfi } = await raised(`rfi-${Date.now()}`);
    expect(rfi.status).toBe("OPEN");
    expect(rfi.number).toBe(1);
    expect(rfi.raisedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(rfi.answerEl).toBeNull();
    expect(rfi.answeredById).toBeNull();
    // RULE (R09): default seven days, so 168 hours, and the due moment is
    // exactly that far from when it was raised.
    expect(rfi.slaHours).toBe(168);
    expect(Date.parse(rfi.slaDueAt) - Date.parse(rfi.raisedAt)).toBe(168 * 3_600_000);
    // Freshly raised is as green as it gets.
    expect(rfi.slaState).toBe("GREEN");
  });

  it("honours a shorter SLA when the body asks for one", async () => {
    const { rfi } = await raised(`rfi-sla-${Date.now()}`, { ...question, slaDays: 2 });
    expect(rfi.slaHours).toBe(48);
    expect(Date.parse(rfi.slaDueAt) - Date.parse(rfi.raisedAt)).toBe(48 * 3_600_000);
  });

  it("numbers them 1, 2, 3 on the contract and lists them newest first", async () => {
    const stamp = `rfi-seq-${Date.now()}`;
    const { contractId } = await raised(stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    for (const expected of [2, 3]) {
      const next = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/rfis`)
        .set(bearer(token))
        .send(question);
      expect(next.status).toBe(201);
      expect(Rfi.parse(next.body).number).toBe(expected);
    }
    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis`)
      .set(bearer(token));
    expect(list.body.map((r: Rfi) => r.number)).toEqual([3, 2, 1]);
  });

  it("hands two engineers raising one together two different numbers", async () => {
    // ADR-0015's advisory lock, on the RFI counter: a race becomes a queue.
    const { contract } = await makeContract(app, `rfi-race-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/rfis`)
        .set(bearer(token))
        .send({ questionEl: "Ταυτόχρονη ερώτηση Α" }),
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/rfis`)
        .set(bearer(token))
        .send({ questionEl: "Ταυτόχρονη ερώτηση Β" }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect([first.body.number as number, second.body.number as number].sort()).toEqual([1, 2]);
  });

  it("refuses a body with no question", async () => {
    const { contract } = await makeContract(app, `rfi-bad-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/rfis`)
      .set(bearer(token))
      .send({ questionEl: "" });
    expect(refused.status).toBe(400);
    expect(refused.body.key).toBe("errors.rfiNotValid");
  });

  // ------------------------------------------------------------- answer and close --

  it("answers then closes, and records who answered", async () => {
    const { contractId, rfi } = await raised(`rfi-answer-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);

    const answered = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ισχύει το πρότυπο EN 1634-1, κλάση EI 60." });
    expect(answered.status).toBe(200);
    const after = Rfi.parse(answered.body);
    expect(after.status).toBe("ANSWERED");
    expect(after.answerEl).toContain("EI 60");
    expect(after.answeredAt).not.toBeNull();
    // RULE (CAPEX-01 §1, ADR-0017): the answerer may be the raiser. An RFI is
    // a question put to the ΟΚΥπΥ side and staff attach the reply.
    expect(after.answeredById).toBe(after.raisedById);

    const closed = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    expect(closed.status).toBe(200);
    expect(Rfi.parse(closed.body).status).toBe("CLOSED");
  });

  it("refuses to close an RFI nobody has answered", async () => {
    const { contractId, rfi } = await raised(`rfi-early-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.rfiNotAnswered");
  });

  it("refuses a second answer and a second close", async () => {
    const { contractId, rfi } = await raised(`rfi-twice-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const answer = { answerEl: "Η πρώτη και μοναδική απάντηση." };
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send(answer);

    const again = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send(answer);
    expect(again.status).toBe(422);
    expect(again.body.key).toBe("errors.rfiNotOpen");

    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    const closedTwice = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    expect(closedTwice.status).toBe(422);
    expect(closedTwice.body.key).toBe("errors.rfiAlreadyClosed");
  });

  // ------------------------------------------------------------------ the clock --

  it("agrees with the SlaChip at every boundary", async () => {
    const { contractId, rfi } = await raised(`rfi-band-${Date.now()}`);
    // A seven-day promise, 168 hours, and the remaining share moved by hand.
    const cases: [number, Rfi["slaState"]][] = [
      [168 * 0.51, "GREEN"],
      [168 * 0.5, "AMBER"],
      [168 * 0.1, "RED"],
      [168 * 0.09, "RED"],
      [-1, "BREACHED"],
    ];
    for (const [hoursLeft, expected] of cases) {
      await setDue(rfi.id, hoursLeft, 168);
      expect(await bandOf(contractId, rfi.id)).toBe(expected);
    }
  });

  it("stops the clock at the answer, so a breach cannot creep up on a closed RFI", async () => {
    const { contractId, rfi } = await raised(`rfi-stop-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Απαντήθηκε εγκαίρως." });

    // An RFI answered ten days ago with five of its seven days still to run,
    // now sitting in the drawer waiting to be closed. Measured against the
    // clock it is long past due; measured against the answer it is GREEN,
    // and the answer is what the promise was about (ADR-0017).
    await client.query(
      `update ecapital.rfi
          set answered_at = now() - interval '10 days',
              sla_due_at  = now() - interval '5 days',
              sla_hours   = 168
        where id = $1`,
      [rfi.id],
    );
    expect(await bandOf(contractId, rfi.id)).toBe("GREEN");
  });

  it("never blocks on a breach: a breached RFI is still answered and closed", async () => {
    // R33's pattern and CAPEX-01 §1: warn and flag, never stop the work.
    const { contractId, rfi } = await raised(`rfi-breach-${Date.now()}`);
    await setDue(rfi.id, -72, 168);
    expect(await bandOf(contractId, rfi.id)).toBe("BREACHED");

    const token = await tokenFor(app, USERS.estatesNicosia);
    const answered = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Καθυστερημένη αλλά πλήρης απάντηση." });
    expect(answered.status).toBe(200);
    const closed = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    expect(closed.status).toBe(200);
  });

  it("counts the open and the breached on the contract screen", async () => {
    const stamp = `rfi-count-${Date.now()}`;
    const { contractId, rfi } = await raised(stamp);
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis`)
      .set(bearer(token))
      .send(question);
    await setDue(rfi.id, -5, 168);

    const detail = await request(app.getHttpServer())
      .get(`/contracts/${contractId}`)
      .set(bearer(token));
    const parsed = ContractDetail.parse(detail.body);
    expect(parsed.rfisOpen).toBe(2);
    expect(parsed.rfisBreached).toBe(1);
  });

  // ------------------------------------------------------------------- access --

  it("hides another unit's RFIs behind a 404, never a 403", async () => {
    const { contractId, rfi } = await raised(`rfi-rls-${Date.now()}`);
    // The Larnaca engineer cannot see a Nicosia contract, so nothing on it
    // exists for them — a 403 would confirm that it does (ADR-0010).
    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis`)
      .set(bearer(larnaca));
    expect(list.status).toBe(404);
    expect(list.body.key).toBe("errors.contractNotFound");

    const answered = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(larnaca))
      .send({ answerEl: "Δεν θα έπρεπε να περάσει." });
    expect(answered.status).toBe(404);
  });

  it("refuses the auditor and the executive a write and lets them read", async () => {
    const { contractId } = await raised(`rfi-ro-${Date.now()}`);
    for (const email of [USERS.auditor, USERS.executive]) {
      const token = await tokenFor(app, email);
      const read = await request(app.getHttpServer())
        .get(`/contracts/${contractId}/rfis`)
        .set(bearer(token));
      expect(read.status).toBe(200);
      const refused = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/rfis`)
        .set(bearer(token))
        .send(question);
      expect(refused.status).toBe(403);
      expect(refused.body.key).toBe("errors.readOnlyAccount");
    }
  });

  it("writes an audit row with the actor for every RFI mutation", async () => {
    // R42.
    const { contractId, rfi } = await raised(`rfi-audit-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(estates))
      .send({ answerEl: "Καταγράφεται στο ιστορικό." });

    const auditor = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "rfi", entity_id: rfi.id })
      .set(bearer(auditor));
    expect(log.status).toBe(200);
    expect(log.body.length).toBe(2);
    expect(log.body.map((e: { action: string }) => e.action).sort()).toEqual([
      "INSERT",
      "UPDATE",
    ]);
    for (const entry of log.body) {
      expect(entry.actorId).toBe("dev-estates-nicosia");
      expect(entry.orgUnitId).toBe("nicosia-general");
    }
  });
});
