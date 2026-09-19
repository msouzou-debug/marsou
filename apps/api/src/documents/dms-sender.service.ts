/**
 * The sender: once a minute, take what is due off the queue and file it.
 *
 * It runs on a timer and not inside a request, so it has no caller and no
 * row policy to run under. Everything it does to the queue goes through the
 * four SECURITY DEFINER functions migration 0014 declares — claim, mark
 * sent, mark failed, mark for retry — which is what «service-only» means for
 * `dms_outbox` (ADR-0023).
 *
 * The three answers and what each one costs:
 *
 *   sent           → SENT, the protocol on the outbox row and on the document.
 *   refused (4xx)  → FAILED with eArchive's own code, an email to the
 *                    administrator, and no second attempt. A 400 does not
 *                    become a 201 by being sent again.
 *   unavailable    → back in the queue at 1 minute, then 5, 15, 60, then
 *                    hourly. Never dropped. eArchive being down is not a
 *                    reason to lose a protocol entry.
 *
 * With no `EARCHIVE_URL` or no `ECAPITAL_INGEST_TOKEN` the client is the
 * `NullClient` and every item stays QUEUED: the queue holds until the token
 * is placed on the server, and drains in order afterwards.
 */
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { sql } from "drizzle-orm";
import { CONFIG, type AppConfig } from "../config";
import { DatabaseService } from "../db/client";
import { DMS_CLIENT, type DmsClient, type SendPart } from "./dms-client";
import {
  type DmsFile,
  type DmsMeta,
  type DmsMetaBody,
  backoffMinutes,
  isoWithOffset,
} from "./earchive-contract";
import { OBJECT_STORE, type ObjectStore } from "./object-store";

/** How many items one pass takes. Small: each is a multipart upload. */
const BATCH = 5;
export const DRAIN_INTERVAL_MS = 60_000;

interface OutboxRow {
  id: string;
  source_ref: string;
  meta: DmsMetaBody;
  files: (DmsFile & { object_key: string })[];
  attempts: number;
}

@Injectable()
export class DmsSenderService implements OnModuleInit {
  private readonly logger = new Logger(DmsSenderService.name);
  private draining = false;

  constructor(
    private readonly database: DatabaseService,
    @Inject(DMS_CLIENT) private readonly client: DmsClient,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit(): void {
    if (!this.client.configured) {
      this.logger.warn(
        "eArchive is not configured (EARCHIVE_URL / ECAPITAL_INGEST_TOKEN). Documents are queued and nothing is sent.",
      );
    }
  }

  /**
   * Every minute. `draining` is the guard against a slow pass overlapping the
   * next one; the claim is a lease as well, so two processes would not send
   * the same item either.
   */
  @Interval("ecapital.dms.drain", DRAIN_INTERVAL_MS)
  async drainTick(): Promise<void> {
    if (this.config.NODE_ENV === "test") return;
    await this.drain();
  }

  /** One pass. Returns how many items it sent, for the tests and the logs. */
  async drain(limit = BATCH): Promise<{ claimed: number; sent: number }> {
    if (this.draining) return { claimed: 0, sent: 0 };
    this.draining = true;
    try {
      // Nothing is claimed while the token is missing. Claiming would move
      // rows to SENDING and push their next attempt out by the lease, which
      // would make «held, untouched» look like «tried and waiting».
      if (!this.client.configured) return { claimed: 0, sent: 0 };

      const claimed = await this.claim(limit);
      let sent = 0;
      for (const row of claimed) {
        if (await this.sendOne(row)) sent += 1;
      }
      return { claimed: claimed.length, sent };
    } finally {
      this.draining = false;
    }
  }

  private async claim(limit: number): Promise<OutboxRow[]> {
    const result = await this.database.unscoped.execute(
      sql`select id, source_ref, meta, files, attempts
            from ecapital.dms_claim_due(${limit}::int)`,
    );
    return (result.rows as unknown as OutboxRow[]) ?? [];
  }

  private async sendOne(row: OutboxRow): Promise<boolean> {
    let parts: SendPart[];
    try {
      parts = await Promise.all(
        row.files.map(async (file) => ({
          file: stripObjectKey(file),
          bytes: await this.store.get(file.object_key),
        })),
      );
    } catch (error) {
      // The bytes are not where the row says they are. That is a fault on
      // this side and waiting will not mend it, so it is recorded the same
      // way a refusal is: FAILED, with a code, and somebody is told.
      await this.markFailed(row.id, "OBJECT_MISSING", messageOf(error));
      this.logger.error(`dms outbox ${row.source_ref}: the stored file is missing`);
      return false;
    }

    // `outbox_id` and `sent_at` are facts about the sending and are added
    // now, not when the item was queued — an item can wait a week in the
    // queue and `sent_at` has to say when the request actually left.
    const meta: DmsMeta = {
      ...row.meta,
      outbox_id: row.id,
      sent_at: isoWithOffset(new Date()),
    };

    const result = await this.client.send({ outboxId: row.id, meta, parts });

    switch (result.outcome) {
      case "sent":
        await this.database.unscoped.execute(
          sql`select ecapital.dms_mark_sent(${row.id}::uuid, ${result.protocolId}::text, ${result.protocolNumber}::text)`,
        );
        this.logger.log(
          `dms outbox ${row.source_ref}: filed as ${result.protocolNumber}${result.replayed ? " (replayed)" : ""}`,
        );
        return true;

      case "refused":
        await this.markFailed(row.id, result.code, result.message);
        this.logger.error(`dms outbox ${row.source_ref}: eArchive refused it (${result.code})`);
        return false;

      case "not-configured":
      case "unavailable":
      default:
        await this.markRetry(row, result.code, result.message);
        return false;
    }
  }

  private async markFailed(id: string, code: string, message: string): Promise<void> {
    await this.database.unscoped.execute(
      sql`select ecapital.dms_mark_failed(${id}::uuid, ${code}::text, ${message}::text)`,
    );
  }

  /** 1 minute, 5, 15, 60, then hourly. Never dropped. */
  private async markRetry(row: OutboxRow, code: string, message: string): Promise<void> {
    const minutes = backoffMinutes(row.attempts + 1);
    const next = new Date(Date.now() + minutes * 60_000);
    await this.database.unscoped.execute(
      sql`select ecapital.dms_mark_retry(${row.id}::uuid, ${code}::text, ${message}::text, ${next.toISOString()}::timestamptz)`,
    );
    this.logger.warn(
      `dms outbox ${row.source_ref}: ${code}, trying again in ${minutes} minute(s)`,
    );
  }
}

/** The object key is ours; `meta.files[]` is strict and must not carry it. */
function stripObjectKey(file: DmsFile & { object_key: string }): DmsFile {
  const rest = { ...file } as DmsFile & { object_key?: string };
  delete rest.object_key;
  return rest;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
