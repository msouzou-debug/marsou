import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { CONFIG, loadConfig } from "../src/config";
import {
  DMS_CLIENT,
  type DmsClient,
  type SendRequest,
  type SendResult,
} from "../src/documents/dms-client";
import { DmsSenderService } from "../src/documents/dms-sender.service";
import { USERS, bearer, tokenFor } from "./app";
import { makeContract } from "./contract-support";

/**
 * ADR-0023 — the sender, and the three answers eArchive can give it.
 *
 * The client is replaced by a fake at the `DmsClient` port, so what these
 * tests exercise is everything the sender does with an answer: the protocol
 * on both rows, the refusal that is never retried and tells somebody, and the
 * backoff that never drops an item. What they do not exercise is the
 * multipart conversation itself, for the same reason ADR-0018 gives about
 * LDAP — there is no eArchive on this machine to have it with.
 */
const PDF = Buffer.from("%PDF-1.7\nΔοκιμαστικό έγγραφο\n%%EOF\n", "utf8");

class FakeClient implements DmsClient {
  readonly configured = true;
  answer: SendResult = {
    outcome: "sent",
    protocolId: "p-1",
    protocolNumber: "ΤΥ/2026/00001",
    replayed: false,
  };
  seen: SendRequest[] = [];

  send(request_: SendRequest): Promise<SendResult> {
    this.seen.push(request_);
    return Promise.resolve(this.answer);
  }
}

describe("the eArchive sender", () => {
  let app: INestApplication;
  let admin: Client;
  let client: FakeClient;
  let sender: DmsSenderService;

  beforeAll(async () => {
    client = new FakeClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CONFIG)
      .useValue(
        loadConfig({
          ...process.env,
          EARCHIVE_URL: "http://127.0.0.1:5011",
          ECAPITAL_INGEST_TOKEN: "a-test-token-long-enough",
        }),
      )
      .overrideProvider(DMS_CLIENT)
      .useValue(client)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    sender = app.get(DmsSenderService);

    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  beforeEach(() => {
    client.seen = [];
  });

  /** Nothing from an earlier suite in the way: this one drains what it queues. */
  async function park(): Promise<void> {
    await admin.query(
      "update ecapital.dms_outbox set status = 'HELD' where status in ('QUEUED', 'SENDING')",
    );
  }

  async function queueAward(stamp: string): Promise<{ sourceRef: string; documentId: string }> {
    await park();
    const { contract } = await makeContract(app, stamp);
    const token = await tokenFor(app, USERS.admin);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    expect(filed.status).toBe(201);
    return { sourceRef: `award:${contract.id}`, documentId: filed.body.id as string };
  }

  async function row(sourceRef: string) {
    const { rows } = await admin.query<{
      status: string;
      attempts: number;
      next_attempt_at: Date;
      last_error_code: string | null;
      protocol_number: string | null;
    }>("select * from ecapital.dms_outbox where source_ref = $1", [sourceRef]);
    return rows[0];
  }

  it("sends the meta with outbox_id and sent_at, and the file under its own part name", async () => {
    const { sourceRef } = await queueAward(`send-${Date.now()}`);
    client.answer = {
      outcome: "sent",
      protocolId: "p-42",
      protocolNumber: "ΤΥ/2026/00042",
      replayed: false,
    };
    const result = await sender.drain();
    expect(result.sent).toBe(1);

    const sent = client.seen[0];
    expect(sent.meta.source_ref).toBe(sourceRef);
    // Facts about the sending, added now and not when the item was queued.
    expect(sent.meta.outbox_id).toBe(sent.outboxId);
    expect(sent.meta.sent_at).toMatch(/[+-]\d{2}:\d{2}$/);
    // The binary part's field name is what `meta.files[].part_name` promised,
    // and the object key is ours and never goes on the wire.
    expect(sent.parts).toHaveLength(1);
    expect(sent.parts[0].file.part_name).toBe(sent.meta.files[0].part_name);
    expect(sent.parts[0].bytes.equals(PDF)).toBe(true);
    expect((sent.meta.files[0] as Record<string, unknown>).object_key).toBeUndefined();
  });

  it("stores the protocol on the queue row and on the document, and nothing else", async () => {
    const { sourceRef, documentId } = await queueAward(`protocol-${Date.now()}`);
    client.answer = {
      outcome: "sent",
      protocolId: "p-7",
      protocolNumber: "ΤΥ/2026/00007",
      replayed: false,
    };
    await sender.drain();

    const queued = await row(sourceRef);
    expect(queued.status).toBe("SENT");
    expect(queued.protocol_number).toBe("ΤΥ/2026/00007");

    const { rows } = await admin.query<{ protocol_id: string; protocol_number: string }>(
      "select protocol_id, protocol_number from ecapital.document where id = $1",
      [documentId],
    );
    expect(rows[0]).toMatchObject({ protocol_id: "p-7", protocol_number: "ΤΥ/2026/00007" });
  });

  /** 200 with Idempotency-Replayed is the same answer as 201. */
  it("treats a replay as a successful filing", async () => {
    const { sourceRef } = await queueAward(`replay-${Date.now()}`);
    client.answer = {
      outcome: "sent",
      protocolId: "p-9",
      protocolNumber: "ΤΥ/2026/00009",
      replayed: true,
    };
    await sender.drain();
    expect((await row(sourceRef)).status).toBe("SENT");
  });

  /**
   * RULE (ADR-0023): a 4xx is never retried. eArchive has looked at the
   * document and said no, and no amount of waiting makes a SCHEMA_INVALID
   * into a 201. An administrator is told, through email_outbox — the same
   * channel the R31 budget warnings use, because there is still no SMTP.
   */
  it("fails a refusal once, keeps eArchive's own code, and writes to the admin", async () => {
    const { sourceRef } = await queueAward(`refused-${Date.now()}`);
    client.answer = {
      outcome: "refused",
      code: "SCHEMA_INVALID",
      message: "meta.category is not known",
    };
    await sender.drain();

    const failed = await row(sourceRef);
    expect(failed.status).toBe("FAILED");
    expect(failed.last_error_code).toBe("SCHEMA_INVALID");
    expect(failed.attempts).toBe(1);

    const { rows } = await admin.query<{ subject_el: string; body_el: string }>(
      "select subject_el, body_el from ecapital.email_outbox where entity_type = 'dms_outbox' order by created_at desc limit 1",
    );
    expect(rows[0].subject_el).toContain("eArchive");
    expect(rows[0].body_el).toContain("SCHEMA_INVALID");

    // And a second drain leaves it alone: a FAILED item is not due again.
    client.seen = [];
    await sender.drain();
    expect(client.seen).toHaveLength(0);
  });

  /**
   * RULE (ADR-0023): a 5xx or a refused connection is a delay, not a
   * refusal. 1 minute, then 5, 15, 60, then hourly — and never dropped.
   */
  it("backs off on a 5xx and never drops the item", async () => {
    const { sourceRef } = await queueAward(`retry-${Date.now()}`);
    client.answer = { outcome: "unavailable", code: "HTTP_503", message: "Service Unavailable" };
    const before = Date.now();
    await sender.drain();

    const queued = await row(sourceRef);
    expect(queued.status).toBe("QUEUED");
    expect(queued.attempts).toBe(1);
    expect(queued.last_error_code).toBe("HTTP_503");
    const waitMinutes = (queued.next_attempt_at.getTime() - before) / 60_000;
    expect(waitMinutes).toBeGreaterThan(0.5);
    expect(waitMinutes).toBeLessThan(2);

    // Not due yet, so the next pass leaves it where it is.
    client.seen = [];
    await sender.drain();
    expect(client.seen).toHaveLength(0);

    // The fourth wait is an hour, and every wait after it is an hour too.
    await admin.query(
      "update ecapital.dms_outbox set attempts = 4, next_attempt_at = now() where source_ref = $1",
      [sourceRef],
    );
    const again = Date.now();
    await sender.drain();
    const later = await row(sourceRef);
    expect(later.status).toBe("QUEUED");
    expect((later.next_attempt_at.getTime() - again) / 60_000).toBeGreaterThan(55);
  });

  it("fails an item whose stored file has gone, rather than trying forever", async () => {
    const { sourceRef } = await queueAward(`missing-${Date.now()}`);
    await admin.query(
      `update ecapital.dms_outbox
          set files = jsonb_set(files, '{0,object_key}', '"award/nowhere/gone.pdf"')
        where source_ref = $1`,
      [sourceRef],
    );
    await sender.drain();
    const failed = await row(sourceRef);
    expect(failed.status).toBe("FAILED");
    expect(failed.last_error_code).toBe("OBJECT_MISSING");
  });
});

/**
 * The hold. This is the state the ΟΚΥπΥ server is in until Marios writes the
 * token into /etc/ecapital/api.env: documents are recorded and queued, and
 * nothing is sent, tried or failed.
 */
describe("the eArchive sender with no token placed", () => {
  let app: INestApplication;
  let admin: Client;

  beforeAll(async () => {
    app = await Test.createTestingModule({ imports: [AppModule] })
      .compile()
      .then((m) => m.createNestApplication({ logger: false }).init());
    admin = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
    await admin.connect();
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  it("holds every item at QUEUED and claims nothing", async () => {
    await admin.query(
      "update ecapital.dms_outbox set status = 'HELD' where status in ('QUEUED', 'SENDING')",
    );
    const { contract } = await makeContract(app, `hold-${Date.now()}`);
    const token = await tokenFor(app, USERS.admin);
    const filed = await request(app.getHttpServer())
      .post(`/contracts/${contract.id}/documents`)
      .set(bearer(token))
      .attach("file", PDF, { filename: "apofasi.pdf", contentType: "application/pdf" });
    expect(filed.status).toBe(201);

    const sender = app.get(DmsSenderService);
    expect(await sender.drain()).toEqual({ claimed: 0, sent: 0 });

    const { rows } = await admin.query<{ status: string; attempts: number }>(
      "select status, attempts from ecapital.dms_outbox where source_ref = $1",
      [`award:${contract.id}`],
    );
    // Held, untouched: not SENDING, not FAILED, and no attempt counted.
    expect(rows[0]).toMatchObject({ status: "QUEUED", attempts: 0 });
  });
});
