import type { INestApplication } from "@nestjs/common";
import { ContractDetail, Rfi, RfiDocument, nicosiaDateOf } from "@ecapital/shared";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { USERS, bearer, createTestApp, tokenFor } from "./app";
import { makeContract } from "./contract-support";
import { binary } from "./maintenance-support";

/**
 * R09 — the RFI log and its SLA clock. Αίτημα διευκρίνισης.
 *
 * The band tests go round the API to move `sla_due_at` directly in Postgres,
 * because the only way to put a real RFI at 51% of its window is to say where
 * its window ends. What they assert is the same function
 * `src/rfis/rfi-rows.test.ts` pins, coming back through the HTTP layer.
 */
const question = {
  questionEl: "Ποιο πρότυπο ισχύει για τα πυράντοχα κουφώματα;",
  recipientName: "Ελένη Χαραλάμπους, Γραφείο μελετών",
};

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
        .send({ ...question, questionEl: "Ταυτόχρονη ερώτηση Α" }),
      request(app.getHttpServer())
        .post(`/contracts/${contract.id}/rfis`)
        .set(bearer(token))
        .send({ ...question, questionEl: "Ταυτόχρονη ερώτηση Β" }),
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
      .send({ ...question, questionEl: "" });
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

  it("closes an RFI nobody has answered only with a closing note, and records who and when", async () => {
    // RULE (owner, UAT 25/11/2026): closed with or without an answer; with
    // none, the note says why.
    const { contractId, rfi } = await raised(`rfi-early-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.rfiCloseNoteNeeded");
    const blank = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token))
      .send({ closingNote: "   " });
    expect(blank.status).toBe(422);
    expect(blank.body.key).toBe("errors.rfiCloseNoteNeeded");
    const tooLong = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token))
      .send({ closingNote: "α".repeat(4001) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.key).toBe("errors.rfiCloseNotValid");

    const closed = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token))
      .send({ closingNote: "Διευθετήθηκε στο εργοτάξιο με τον μελετητή." });
    expect(closed.status).toBe(200);
    const after = Rfi.parse(closed.body);
    expect(after.status).toBe("CLOSED");
    expect(after.answerEl).toBeNull();
    expect(after.closingNote).toBe("Διευθετήθηκε στο εργοτάξιο με τον μελετητή.");
    expect(after.closedById).toBe(after.raisedById);
    expect(after.closedByName).toBe("Ανδρέας Παπαδόπουλος");
    expect(after.closedAt).not.toBeNull();

    // Closed is closed: no answer, no edit, no second close.
    const answer = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Αργά." });
    expect(answer.status).toBe(422);
    expect(answer.body.key).toBe("errors.rfiAlreadyClosed");
    const edit = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ questionEl: "Άλλη ερώτηση" });
    expect(edit.status).toBe(422);
    expect(edit.body.key).toBe("errors.rfiClosedNoEdit");
  });

  it("closes an answered RFI with or without a note", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    for (const note of [undefined, "Η απάντηση εφαρμόστηκε."]) {
      const { contractId, rfi } = await raised(`rfi-note-${Date.now()}-${note ? 1 : 0}`);
      await request(app.getHttpServer())
        .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
        .set(bearer(token))
        .send({ answerEl: "Ναι." })
        .expect(200);
      const closed = await request(app.getHttpServer())
        .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
        .set(bearer(token))
        .send(note ? { closingNote: note } : {});
      expect(closed.status).toBe(200);
      expect(Rfi.parse(closed.body).closingNote).toBe(note ?? null);
    }
  });

  it("records the day the answer arrived: today by default, never after today or before it was raised", async () => {
    const { contractId, rfi } = await raised(`rfi-answered-on-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const today = nicosiaDateOf(new Date());
    const tomorrow = nicosiaDateOf(new Date(Date.now() + 86_400_000));
    const future = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ναι.", answeredOn: tomorrow });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");

    // Raised three days ago, in Postgres: the day before that is refused,
    // the day it was raised is fine.
    await client.query(`update ecapital.rfi set raised_at = raised_at - interval '3 days' where id = $1`, [rfi.id]);
    const raisedOn = nicosiaDateOf(new Date(Date.now() - 3 * 86_400_000));
    const dayBefore = nicosiaDateOf(new Date(Date.now() - 4 * 86_400_000));
    const early = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ναι.", answeredOn: dayBefore });
    expect(early.status).toBe(422);
    expect(early.body.key).toBe("errors.rfiAnsweredBeforeRaised");

    const ok = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ναι.", answeredOn: raisedOn });
    expect(ok.status).toBe(200);
    const after = Rfi.parse(ok.body);
    expect(after.answeredOn).toBe(raisedOn);
    // The moment it was typed in stays the record.
    expect(nicosiaDateOf(after.answeredAt ?? "")).toBe(today);

    const { contractId: other, rfi: plain } = await raised(`rfi-answered-today-${Date.now()}`);
    const byDefault = await request(app.getHttpServer())
      .post(`/contracts/${other}/rfis/${plain.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ναι." });
    expect(Rfi.parse(byDefault.body).answeredOn).toBe(today);
  });

  it("refuses a closing note with no answer at the database too", async () => {
    // ADR-0015's reason: the CHECK says the same to every code path.
    const { rfi } = await raised(`rfi-check-${Date.now()}`);
    await expect(
      client.query(`update ecapital.rfi set status = 'CLOSED', closed_at = now() where id = $1`, [rfi.id]),
    ).rejects.toThrow(/rfi_closed_answer_or_note/);
    await expect(
      client.query(`update ecapital.rfi set closing_note = 'x' where id = $1`, [rfi.id]),
    ).rejects.toThrow(/rfi_closing_only_when_closed/);
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

  it("stops the clock at the day the answer arrived, and at the close of an unanswered RFI", async () => {
    const token = await tokenFor(app, USERS.estatesNicosia);
    // Raised five days ago with a three-day promise; the answer arrived on
    // the day it was raised and was typed in today. Against the typing it
    // is BREACHED; against the day it arrived it was well inside.
    const { contractId, rfi } = await raised(`rfi-stop-day-${Date.now()}`);
    await client.query(
      `update ecapital.rfi
          set raised_at = now() - interval '5 days',
              sla_due_at = now() - interval '2 days',
              sla_hours = 72
        where id = $1`,
      [rfi.id],
    );
    const raisedOn = nicosiaDateOf(new Date(Date.now() - 5 * 86_400_000));
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Ναι.", answeredOn: raisedOn })
      .expect(200);
    expect(await bandOf(contractId, rfi.id)).not.toBe("BREACHED");

    // Closed without an answer while GREEN, then the promise runs out: the
    // band stays the one it was closed in.
    const { contractId: other, rfi: moot } = await raised(`rfi-stop-close-${Date.now()}`);
    await request(app.getHttpServer())
      .post(`/contracts/${other}/rfis/${moot.id}/close`)
      .set(bearer(token))
      .send({ closingNote: "Δεν χρειάζεται πια." })
      .expect(200);
    // Due three days ago, closed seven days ago with four of its seven days
    // still to run (57 %).
    await client.query(
      `update ecapital.rfi
          set sla_due_at = now() - interval '3 days', sla_hours = 168,
              closed_at = now() - interval '7 days'
        where id = $1`,
      [moot.id],
    );
    expect(await bandOf(other, moot.id)).toBe("GREEN");
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

  // ---------------------------------------------- editing one (UAT 25/11/2026) --

  /** A Nicosia calendar day this many days from the given instant. */
  function dayFrom(iso: string, days: number): string {
    const date = new Date(`${nicosiaDateOf(iso)}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  it("corrects the question and the due date, and the audit trail keeps both", async () => {
    const { contractId, rfi } = await raised(`rfi-edit-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const dueDate = dayFrom(rfi.raisedAt, 10);
    const edited = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ questionEl: "Ποιο πρότυπο πυραντοχής ισχύει για τις πόρτες του διαδρόμου;", dueDate });
    expect(edited.status).toBe(200);
    const after = Rfi.parse(edited.body);
    expect(after.questionEl).toBe("Ποιο πρότυπο πυραντοχής ισχύει για τις πόρτες του διαδρόμου;");
    // Due by the end of that day in Nicosia; who raised it, and when, unchanged.
    expect(nicosiaDateOf(after.slaDueAt)).toBe(dueDate);
    expect(Date.parse(after.slaDueAt)).toBeGreaterThan(Date.parse(rfi.slaDueAt));
    expect(after.slaHours).toBeGreaterThanOrEqual(9 * 24);
    expect(after.raisedAt).toBe(rfi.raisedAt);
    expect(after.raisedByName).toBe(rfi.raisedByName);
    expect(after.number).toBe(rfi.number);

    // Sending the same due date again moves nothing.
    const same = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ dueDate });
    expect(Rfi.parse(same.body).slaDueAt).toBe(after.slaDueAt);

    const auditor = await tokenFor(app, USERS.auditor);
    const log = await request(app.getHttpServer())
      .get("/audit-log")
      .query({ entity_type: "rfi", entity_id: rfi.id })
      .set(bearer(auditor));
    expect(log.body.map((e: { action: string }) => e.action).sort()).toEqual(["INSERT", "UPDATE"]);
  });

  it("allows the day it was raised as the due date and refuses the day before", async () => {
    const { contractId, rfi } = await raised(`rfi-edit-due-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const sameDay = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ dueDate: dayFrom(rfi.raisedAt, 0) });
    expect(sameDay.status).toBe(200);

    const before = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ dueDate: dayFrom(rfi.raisedAt, -1) });
    expect(before.status).toBe(422);
    expect(before.body.key).toBe("errors.rfiDueBeforeRaised");
  });

  it("refuses a body that is not a change, and an edit to a closed RFI", async () => {
    const { contractId, rfi } = await raised(`rfi-edit-closed-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const bad = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ questionEl: "", dueDate: "30/11/2026" });
    expect(bad.status).toBe(400);
    expect(bad.body.key).toBe("errors.rfiUpdateNotValid");

    // Answered is still editable; closed is not.
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Το EN 1634-1, E30." });
    const whileAnswered = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ questionEl: "Ποιο πρότυπο ισχύει για τα κουφώματα;" });
    expect(whileAnswered.status).toBe(200);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    const closed = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ questionEl: "Αργά πια." });
    expect(closed.status).toBe(422);
    expect(closed.body.key).toBe("errors.rfiClosedNoEdit");
  });

  it("refuses the edit to a read-only account and hides it from another unit", async () => {
    const { contractId, rfi } = await raised(`rfi-edit-rls-${Date.now()}`);
    const auditor = await tokenFor(app, USERS.auditor);
    const refused = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(auditor))
      .send({ questionEl: "Δεν θα έπρεπε να περάσει." });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.readOnlyAccount");

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const hidden = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(larnaca))
      .send({ questionEl: "Δεν θα έπρεπε να περάσει." });
    expect(hidden.status).toBe(404);
  });

  // ------------------- recipient and sent day (owner decision 25/11/2026) --

  it("records who the RFI went to, the address and the day it was sent", async () => {
    const today = nicosiaDateOf(new Date());
    const { rfi } = await raised(`rfi-recipient-${Date.now()}`, {
      ...question,
      recipientEmail: "eleni.charalambous@designers.example",
      sentOn: today,
    });
    expect(rfi.recipientName).toBe("Ελένη Χαραλάμπους, Γραφείο μελετών");
    expect(rfi.recipientEmail).toBe("eleni.charalambous@designers.example");
    expect(rfi.sentOn).toBe(today);
  });

  it("refuses a new RFI with no recipient, a bad address, or a sent day out of range", async () => {
    const { contract } = await makeContract(app, `rfi-recipient-bad-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post(`/contracts/${contract.id}/rfis`).set(bearer(token)).send(body);

    const noRecipient = await post({ questionEl: question.questionEl });
    expect(noRecipient.status).toBe(400);
    expect(noRecipient.body.key).toBe("errors.rfiRecipientNeeded");

    const blankRecipient = await post({ ...question, recipientName: "   " });
    expect(blankRecipient.status).toBe(400);
    expect(blankRecipient.body.key).toBe("errors.rfiRecipientNeeded");

    const badEmail = await post({ ...question, recipientEmail: "not an address" });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.key).toBe("errors.rfiRecipientEmailNotValid");

    const tomorrow = dayFrom(new Date().toISOString(), 1);
    const future = await post({ ...question, sentOn: tomorrow });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");

    // Raised today, so sent yesterday is before it was raised.
    const yesterday = dayFrom(new Date().toISOString(), -1);
    const early = await post({ ...question, sentOn: yesterday });
    expect(early.status).toBe(422);
    expect(early.body.key).toBe("errors.rfiSentBeforeRaised");
  });

  it("edits the recipient and the sent day while open, and the old row with none can gain them", async () => {
    const { contractId, rfi } = await raised(`rfi-recipient-edit-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    // An RFI from before the fields existed: no recipient at all.
    await client.query(
      `update ecapital.rfi set recipient_name = null, raised_at = raised_at - interval '3 days',
              sla_due_at = sla_due_at - interval '3 days' where id = $1`,
      [rfi.id],
    );
    const before = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis`)
      .set(bearer(token));
    expect(Rfi.parse(before.body.find((r: Rfi) => r.id === rfi.id)).recipientName).toBeNull();

    const raisedOn = dayFrom(rfi.raisedAt, -3);
    const sentOn = dayFrom(rfi.raisedAt, -2);
    const edited = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ recipientName: "Κώστας Ιωάννου", recipientEmail: "k.ioannou@contractor.example", sentOn });
    expect(edited.status).toBe(200);
    const after = Rfi.parse(edited.body);
    expect(after.recipientName).toBe("Κώστας Ιωάννου");
    expect(after.recipientEmail).toBe("k.ioannou@contractor.example");
    expect(after.sentOn).toBe(sentOn);

    // The day it was raised is allowed; the day before is not.
    const sameDay = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ sentOn: raisedOn });
    expect(sameDay.status).toBe(200);
    const tooEarly = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ sentOn: dayFrom(rfi.raisedAt, -4) });
    expect(tooEarly.status).toBe(422);
    expect(tooEarly.body.key).toBe("errors.rfiSentBeforeRaised");
    const future = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ sentOn: dayFrom(new Date().toISOString(), 2) });
    expect(future.status).toBe(400);
    expect(future.body.key).toBe("errors.dateInFuture");

    // The address and the day can be cleared; the name cannot be blanked.
    const cleared = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ recipientEmail: null, sentOn: null });
    expect(cleared.status).toBe(200);
    expect(Rfi.parse(cleared.body).recipientEmail).toBeNull();
    expect(Rfi.parse(cleared.body).sentOn).toBeNull();
    const blank = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ recipientName: "" });
    expect(blank.status).toBe(400);
    expect(blank.body.key).toBe("errors.rfiRecipientNeeded");
  });

  it("does not change the recipient of a closed RFI", async () => {
    const { contractId, rfi } = await raised(`rfi-recipient-closed-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/answer`)
      .set(bearer(token))
      .send({ answerEl: "Απαντήθηκε." });
    await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/close`)
      .set(bearer(token));
    const refused = await request(app.getHttpServer())
      .patch(`/contracts/${contractId}/rfis/${rfi.id}`)
      .set(bearer(token))
      .send({ recipientName: "Άλλος παραλήπτης" });
    expect(refused.status).toBe(422);
    expect(refused.body.key).toBe("errors.rfiClosedNoEdit");
  });

  // ------------------------------------- evidence (owner decision 25/11/2026) --

  const MSG = Buffer.from("Outlook message bytes, not a real compound file", "utf8");
  const EML = Buffer.from("From: a@b.example\r\nSubject: RFI 1\r\n\r\nΕρώτηση.\r\n", "utf8");

  it("files the sent .msg and the .eml reply, queued for eArchive, listed and readable", async () => {
    const { contractId, rfi } = await raised(`rfi-evidence-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);

    // A browser that does not know .msg says octet-stream; the extension decides.
    const sent = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token))
      .field("titleEl", "Απεσταλμένο μήνυμα ΑΔ 1")
      .attach("file", MSG, { filename: "RFI-1.msg", contentType: "application/octet-stream" });
    expect(sent.status).toBe(201);
    const sentDoc = RfiDocument.parse(sent.body);
    expect(sentDoc.mime).toBe("application/vnd.ms-outlook");
    expect(sentDoc.titleEl).toBe("Απεσταλμένο μήνυμα ΑΔ 1");
    expect(sentDoc.protocolNumber).toBeNull();
    expect(sentDoc.uploadedByName).toBe("Ανδρέας Παπαδόπουλος");

    const reply = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token))
      .attach("file", EML, { filename: "reply.eml", contentType: "application/octet-stream" });
    expect(reply.status).toBe(201);
    expect(RfiDocument.parse(reply.body).mime).toBe("message/rfc822");

    // ADR-0023: the document row and the queue item, one per paper.
    const { rows } = await client.query<{ source_module: string; source_ref: string; kind: string }>(
      `select o.source_module, o.source_ref, d.kind::text as kind
         from ecapital.document d join ecapital.dms_outbox o on o.document_id = d.id
        where d.entity_type = 'rfi' and d.entity_id = $1 order by d.version`,
      [rfi.id],
    );
    expect(rows.map((r) => r.source_ref)).toEqual([`rfi_doc:${rfi.id}:1`, `rfi_doc:${rfi.id}:2`]);
    expect(rows.every((r) => r.source_module === "rfi_document" && r.kind === "RFI_EVIDENCE")).toBe(true);

    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token));
    expect(list.status).toBe(200);
    const docs = list.body.map((d: unknown) => RfiDocument.parse(d));
    expect(docs).toHaveLength(2);
    expect(new Set(docs.map((d: RfiDocument) => d.id))).toEqual(new Set([sentDoc.id, reply.body.id]));

    // The bytes come back through the one content route, as an attachment on ?download=1.
    const content = await request(app.getHttpServer())
      .get(`/documents/${sentDoc.id}/content?download=1`)
      .set(bearer(token))
      .buffer()
      .parse(binary);
    expect(content.status).toBe(200);
    expect(content.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(Buffer.from(content.body as Buffer).equals(MSG)).toBe(true);
  });

  it("files a PDF, and refuses no file and a type eArchive does not take", async () => {
    const { contractId, rfi } = await raised(`rfi-evidence-pdf-${Date.now()}`);
    const token = await tokenFor(app, USERS.estatesNicosia);
    const pdf = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token))
      .attach("file", Buffer.from("%PDF-1.7\n%%EOF\n"), {
        filename: "rfi.pdf",
        contentType: "application/pdf",
      });
    expect(pdf.status).toBe(201);
    expect(pdf.body.mime).toBe("application/pdf");

    const none = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token))
      .field("titleEl", "Χωρίς αρχείο");
    expect(none.status).toBe(400);
    expect(none.body.key).toBe("errors.documentNeeded");

    const dwg = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(token))
      .attach("file", Buffer.from("AC1032"), { filename: "plan.dwg", contentType: "image/vnd.dwg" });
    expect(dwg.status).toBe(422);
    expect(dwg.body.key).toBe("errors.documentMimeRejected");
  });

  it("hides another unit's RFI evidence behind a 404 and refuses a read-only upload", async () => {
    const { contractId, rfi } = await raised(`rfi-evidence-rls-${Date.now()}`);
    const estates = await tokenFor(app, USERS.estatesNicosia);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(estates))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(filed.status).toBe(201);

    const larnaca = await tokenFor(app, USERS.engineerLarnaca);
    const list = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(larnaca));
    expect(list.status).toBe(404);
    const upload = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(larnaca))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(upload.status).toBe(404);
    const content = await request(app.getHttpServer())
      .get(`/documents/${filed.body.id}/content`)
      .set(bearer(larnaca));
    expect(content.status).toBe(404);

    const auditor = await tokenFor(app, USERS.auditor);
    const read = await request(app.getHttpServer())
      .get(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(auditor));
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(auditor))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(refused.status).toBe(403);
    expect(refused.body.key).toBe("errors.readOnlyAccount");
  });

  it("refuses evidence from a role that only reads RFIs", async () => {
    // Finance reads the RFI log (rfisInstructions READ) and files documents
    // elsewhere; an RFI's evidence belongs to whoever writes the RFI. The
    // route asks the matrix first, and 0030 `document_insert_rfi` says the
    // same to any other code path.
    const { contractId, rfi } = await raised(`rfi-evidence-finance-${Date.now()}`);
    const finance = await tokenFor(app, USERS.finance);
    const refused = await request(app.getHttpServer())
      .post(`/contracts/${contractId}/rfis/${rfi.id}/documents`)
      .set(bearer(finance))
      .attach("file", EML, { filename: "sent.eml", contentType: "message/rfc822" });
    expect(refused.status).toBe(403);
  });
});
