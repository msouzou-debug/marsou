/**
 * Recording an eArchive callback and applying what it means.
 *
 * All of it is one call into `ecapital.dms_record_event`, which is
 * SECURITY DEFINER because there is no signed-in caller behind this route and
 * therefore no policy to run under. The function inserts the event with `on
 * conflict do nothing` — the unique index on (event, protocol_id, at) is the
 * idempotency — and applies the marker:
 *
 *   protocol.deleted    → a tombstone: the document row keeps its source_ref
 *                         and its protocol_number and takes a `deleted_at`.
 *                         There is nothing else to keep, because eCapital
 *                         holds no copy of the archive by design.
 *   legal_hold.set      → `legal_hold` on the document row, which blocks any
 *                         local action that would treat the record as
 *                         disposable.
 *   legal_hold.cleared  → the hold comes off.
 *
 * The document is found by protocol id, or by source_ref when eArchive sends
 * one — a hold can arrive before the 201 has been recorded if eArchive is
 * quick, and a callback that cannot find its row must not be lost.
 */
import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DatabaseService } from "../db/client";

export interface DmsEventInput {
  event: "protocol.deleted" | "legal_hold.set" | "legal_hold.cleared";
  protocol_id: string;
  protocol_number?: string;
  source_ref?: string;
  at: Date;
}

@Injectable()
export class DmsEventsService {
  constructor(private readonly database: DatabaseService) {}

  /** True when this call recorded it, false when the same event had arrived. */
  async record(input: DmsEventInput): Promise<boolean> {
    const result = await this.database.unscoped.execute(sql`
      select ecapital.dms_record_event(
        ${input.event}::text,
        ${input.protocol_id}::text,
        ${input.protocol_number ?? null}::text,
        ${input.source_ref ?? null}::text,
        ${input.at.toISOString()}::timestamptz) as recorded`);
    const row = (result.rows as unknown as { recorded: boolean }[])[0];
    return Boolean(row?.recorded);
  }
}
