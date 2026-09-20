import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { CONFIG, loadConfig } from "../src/config";
import { USERS, bearer, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * ADR-0023 — `POST /api/v1/dms/events`, what eArchive tells eCapital
 * afterwards, and the four rules the controller holds to.
 *
 * The loopback refusal is ADR-0022's header list pointed inwards: a call from
 * eArchive on the same host has no reason to carry a public-edge header, and
 * one that does either came through something it should not have or is
 * trying to look like it came from somewhere it did not.
 */
const TOKEN = "an-earchive-callback-token";
const PDF = Buffer.from("%PDF-1.7\nΔοκιμαστικό έγγραφο\n%%EOF\n", "utf8");

describe("the eArchive callback", () => {
  let app: INestApplication;
  let admin: Client;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG)
      .useValue(loadConfig({ ...process.env, ECAPITAL_INGEST_TOKEN: TOKEN }))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  /** A filed document with a protocol on it, the way one looks after a 201. */
  async function protocolled(stamp: string): Promise<{
    documentId: string;
    sourceRef: string;
    protocolId: string;
    protocolNumber: string;
  }> {
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    expect(filed.status).toBe(201);

    const protocolId = `p-${stamp}`;
    const protocolNumber = `ΤΥ/2026/${stamp.slice(-5)}`;
    await admin.query(
      "update ecapital.document set protocol_id = $2, protocol_number = $3 where id = $1",
      [filed.body.id, protocolId, protocolNumber],
    );
    return {
      documentId: filed.body.id as string,
      sourceRef: `award:${contract.id}`,
      protocolId,
      protocolNumber,
    };
  }

  async function documentRow(id: string) {
    const { rows } = await admin.query<{
      legal_hold: boolean;
      legal_hold_at: Date | null;
      deleted_at: Date | null;
      protocol_number: string | null;
      source_ref: string | null;
    }>("select * from ecapital.document where id = $1", [id]);
    return rows[0];
  }

  function post(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post("/api/v1/dms/events")
      .set("Authorization", `Bearer ${TOKEN}`)
      .send(body);
  }

  // ------------------------------------------------------ the two refusals --

  /** RULE (ADR-0022, pointed inwards): loopback only. */
  it("refuses any request carrying a public-edge header", async () => {
    for (const header of [
      "X-Forwarded-For",
      "X-Real-IP",
      "Forwarded",
      "CF-Connecting-IP",
      "CF-Ray",
    ]) {
      const refused = await request(app.getHttpServer())
        .post("/api/v1/dms/events")
        .set("Authorization", `Bearer ${TOKEN}`)
        .set(header, header === "Forwarded" ? "for=10.0.0.1" : "10.0.0.1")
        .send({ event: "legal_hold.set", protocol_id: "p-x", at: "2026-09-19T10:00:00Z" });
      expect(refused.status, header).toBe(403);
      expect(refused.body.key, header).toBe("errors.dmsLoopbackOnly");
    }
  });

  it("refuses a missing, malformed or wrong token with 401", async () => {
    const body = {
      event: "legal_hold.set",
      protocol_id: "p-x",
      at: "2026-09-19T10:00:00Z",
    };
    for (const header of [undefined, "Bearer", "Basic abc", `Bearer ${TOKEN}-not-quite`]) {
      let call = request(app.getHttpServer()).post("/api/v1/dms/events");
      if (header) call = call.set("Authorization", header);
      const refused = await call.send(body);
      expect(refused.status, String(header)).toBe(401);
      expect(refused.body.key, String(header)).toBe("errors.dmsTokenNotAccepted");
    }
  });

  it("acknowledges an event kind it does not know, without recording it", async () => {
    // eArchive holds later notices behind any non-2xx (eFinance's warning,
    // 20/09/2026), so an unknown kind is a 200 with `ignored`, not a 400.
    const ack = await post({ event: "protocol.archived", protocol_id: "p-x", at: "2026-09-19T10:00:00Z" });
    expect(ack.status).toBe(200);
    expect(ack.body).toEqual({ recorded: false, ignored: true });
  });

  it("refuses a body that is not an event at all", async () => {
    for (const body of [
      {},
      { event: "legal_hold.set", at: "2026-09-19T10:00:00Z" },
      { event: "legal_hold.set", protocol_id: "p-x", at: "not a date" },
    ]) {
      const refused = await post(body);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(refused.body.key).toBe("errors.dmsEventNotValid");
    }
  });

  // ----------------------------------------------------------- the effects --

  /**
   * RULE (eArchive brief): a legal hold blocks any local action that would
   * treat the record as disposable. The marker is on the document row.
   */
  it("sets and clears the hold marker on the document", async () => {
    const filed = await protocolled(`hold${Date.now()}`);
    const set = await post({
      event: "legal_hold.set",
      protocol_id: filed.protocolId,
      protocol_number: filed.protocolNumber,
      source_ref: filed.sourceRef,
      at: "2026-09-19T10:00:00+03:00",
    });
    expect(set.status).toBe(200);
    expect(set.body.recorded).toBe(true);

    let row = await documentRow(filed.documentId);
    expect(row.legal_hold).toBe(true);
    expect(row.legal_hold_at).not.toBeNull();

    const cleared = await post({
      event: "legal_hold.cleared",
      protocol_id: filed.protocolId,
      source_ref: filed.sourceRef,
      at: "2026-09-20T10:00:00+03:00",
    });
    expect(cleared.status).toBe(200);
    row = await documentRow(filed.documentId);
    expect(row.legal_hold).toBe(false);
    expect(row.legal_hold_at).toBeNull();
  });

  /**
   * RULE (INTEGRATION §6, ADR-0023): eCapital holds no copy of the archive,
   * so what a delete leaves behind is a tombstone — the source_ref, the
   * protocol number it was filed under, and when it went.
   */
  it("keeps a tombstone when eArchive deletes the protocol", async () => {
    const filed = await protocolled(`tomb${Date.now()}`);
    const deleted = await post({
      event: "protocol.deleted",
      protocol_id: filed.protocolId,
      protocol_number: filed.protocolNumber,
      source_ref: filed.sourceRef,
      at: "2026-09-19T11:00:00Z",
    });
    expect(deleted.status).toBe(200);

    const row = await documentRow(filed.documentId);
    expect(row.deleted_at).not.toBeNull();
    // The three things a tombstone is.
    expect(row.source_ref).toBe(filed.sourceRef);
    expect(row.protocol_number).toBe(filed.protocolNumber);
  });

  /** A hold can arrive before the 201 has been written down. */
  it("finds the document by source_ref when the protocol is not on it yet", async () => {
    const { contract } = await makeContract(app, `early${Date.now()}`);
    const token = await tokenFor(app, USERS.admin);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    expect(filed.body.protocolId).toBeNull();

    const set = await post({
      event: "legal_hold.set",
      protocol_id: "p-not-recorded-here",
      source_ref: `award:${contract.id}`,
      at: "2026-09-19T12:00:00Z",
    });
    expect(set.status).toBe(200);
    expect((await documentRow(filed.body.id)).legal_hold).toBe(true);
  });

  // ------------------------------------------------------- the idempotency --

  /**
   * RULE (eArchive brief): the same event twice is 200 both times. The unique
   * index on (event, protocol_id, at) is what decides, not the controller,
   * and `recorded` says which of the two calls did the recording.
   */
  it("answers 200 to the same event twice and records it once", async () => {
    const filed = await protocolled(`idem${Date.now()}`);
    const body = {
      event: "legal_hold.set",
      protocol_id: filed.protocolId,
      source_ref: filed.sourceRef,
      at: "2026-09-19T13:00:00Z",
    };
    const first = await post(body);
    const second = await post(body);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.recorded).toBe(true);
    expect(second.body.recorded).toBe(false);

    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from ecapital.dms_event where protocol_id = $1 and event = 'legal_hold.set'",
      [filed.protocolId],
    );
    expect(Number(rows[0].n)).toBe(1);
    // And the marker is still there: a replay does not undo the first call.
    expect((await documentRow(filed.documentId)).legal_hold).toBe(true);
  });

  /** «Service-only, admin read»: the events are not a unit's to look at. */
  it("keeps the recorded events to the administrator and the auditor", async () => {
    const engineer = await tokenFor(app, USERS.engineerLarnaca);
    const { rows } = await admin.query<{ n: string }>(
      "select count(*)::text as n from ecapital.dms_event",
    );
    expect(Number(rows[0].n)).toBeGreaterThan(0);
    // The policy is what refuses; the engineer's own transaction sees none.
    const seen = await request(app.getHttpServer())
      .get("/admin/dms/outbox")
      .set(bearer(engineer));
    expect(seen.status).toBe(403);
  });
});

/**
 * With no token configured the callback accepts nothing. An open route that
 * writes legal holds is worse than one that is not there yet (ADR-0023).
 */
describe("the eArchive callback with no token placed", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] })
      .compile()
      .then((m) => m.createNestApplication({ logger: false }).init());
  });
  afterAll(async () => {
    await app.close();
  });

  it("refuses every call with 401", async () => {
    const refused = await request(app.getHttpServer())
      .post("/api/v1/dms/events")
      .set("Authorization", "Bearer anything-at-all")
      .send({ event: "legal_hold.set", protocol_id: "p-x", at: "2026-09-19T10:00:00Z" });
    expect(refused.status).toBe(401);
    expect(refused.body.key).toBe("errors.dmsTokenNotAccepted");
  });
});
