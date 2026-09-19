/**
 * `GET /admin/dms/outbox` and `POST /admin/dms/outbox/:id/retry` — what an
 * administrator can see and do about the eArchive queue.
 *
 * The queue is not anybody's unit (migration 0014): the read policy is the
 * administrator's and the auditor's, and there is no write policy at all, so
 * the retry goes through `ecapital.dms_outbox_retry`. The list is the answer
 * to the two questions somebody actually asks — «did it go?» and «why not?»
 * — so it carries the status, the attempt count, eArchive's own error code
 * and the subject line, and it says whether the sender is configured at all.
 * With no token in `/etc/ecapital/api.env` everything sits at QUEUED and
 * `senderConfigured` is false, which is the difference between «held» and
 * «broken».
 */
import { Controller, Get, HttpCode, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { and, desc, eq, sql } from "drizzle-orm";
import { UUID } from "../common/actor";
import { AppError } from "../common/errors";
import { ApiZodError, ApiZodResponse } from "../common/openapi";
import { Roles, RolesGuard } from "../common/roles.guard";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { DMS_CLIENT, type DmsClient } from "./dms-client";
import { DmsOutboxItem, DmsOutboxList, DmsOutboxQuery } from "./dms-contracts";

@ApiTags("documents")
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller("admin/dms")
export class DmsAdminController {
  constructor(@Inject(DMS_CLIENT) private readonly client: DmsClient) {}

  @Get("outbox")
  @Roles("admin", "auditor_readonly")
  @ApiOperation({ summary: "The eArchive queue, newest first" })
  @ApiQuery({ name: "status", required: false, schema: { type: "string" } })
  @ApiQuery({ name: "limit", required: false, schema: { type: "integer", default: 50 } })
  @ApiZodResponse(200, DmsOutboxList, "The queue, and whether the sender is configured")
  @ApiZodError(400, "A status that is not one of the five")
  @ApiZodError(403, "A role that does not read the queue")
  async list(@Query() query: unknown): Promise<DmsOutboxList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const parsed = DmsOutboxQuery.safeParse(query ?? {});
    if (!parsed.success) throw AppError.badRequest("errors.badRequest");

    const where = parsed.data.status
      ? and(eq(schema.dmsOutbox.status, parsed.data.status))
      : undefined;
    const rows = await tx.db
      .select({
        id: schema.dmsOutbox.id,
        sourceRef: schema.dmsOutbox.sourceRef,
        sourceModule: schema.dmsOutbox.sourceModule,
        status: schema.dmsOutbox.status,
        attempts: schema.dmsOutbox.attempts,
        nextAttemptAt: schema.dmsOutbox.nextAttemptAt,
        lastErrorCode: schema.dmsOutbox.lastErrorCode,
        lastErrorMessage: schema.dmsOutbox.lastErrorMessage,
        protocolId: schema.dmsOutbox.protocolId,
        protocolNumber: schema.dmsOutbox.protocolNumber,
        orgUnitId: schema.dmsOutbox.orgUnitId,
        subject: sql<string>`coalesce(${schema.dmsOutbox.meta} ->> 'subject', '')`,
        createdAt: schema.dmsOutbox.createdAt,
        sentAt: schema.dmsOutbox.sentAt,
      })
      .from(schema.dmsOutbox)
      .where(where)
      .orderBy(desc(schema.dmsOutbox.createdAt))
      .limit(parsed.data.limit);

    const items = rows.map((row) =>
      DmsOutboxItem.parse({
        ...row,
        nextAttemptAt: row.nextAttemptAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      }),
    );
    return { items, total: items.length, senderConfigured: this.client.configured };
  }

  /**
   * An administrator has read the error and says try again. The item goes
   * back to the front of the queue with its attempt count intact — the count
   * is the history, not the state — and the next drain picks it up. An item
   * already SENT is left alone: it has a protocol number and resending it
   * would be asking eArchive to file the same paper twice.
   */
  @Post("outbox/:id/retry")
  @HttpCode(200)
  @Roles("admin")
  @ApiOperation({ summary: "Put a failed or held item back in the eArchive queue" })
  @ApiParam({ name: "id", schema: { type: "string", format: "uuid" } })
  @ApiZodResponse(200, DmsOutboxItem, "The item, queued again")
  @ApiZodError(403, "A role that does not work the queue")
  @ApiZodError(404, "No such item")
  @ApiZodError(422, "That item has already been filed")
  async retry(@Param("id") id: string): Promise<DmsOutboxItem> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.dmsOutboxNotFound");

    const [existing] = await tx.db
      .select({ status: schema.dmsOutbox.status })
      .from(schema.dmsOutbox)
      .where(eq(schema.dmsOutbox.id, id))
      .limit(1);
    if (!existing) throw AppError.notFound("errors.dmsOutboxNotFound");
    if (existing.status === "SENT") throw AppError.unprocessable("errors.dmsAlreadyFiled");

    await tx.db.execute(sql`select ecapital.dms_outbox_retry(${id}::uuid)`);
    const items = await this.list({ limit: 200 });
    const item = items.items.find((i) => i.id === id);
    if (!item) throw AppError.notFound("errors.dmsOutboxNotFound");
    return item;
  }
}
