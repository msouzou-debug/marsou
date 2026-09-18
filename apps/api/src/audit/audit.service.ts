import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../common/errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

export const AuditLogEntry = z.object({
  id: z.number(),
  actorId: z.string().nullable(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  at: z.string().describe("UTC, ISO 8601"),
  ip: z.string().nullable(),
  orgUnitId: z.string().nullable(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const AuditLogQuery = z.object({
  entity_type: z.string().min(1).max(64).optional(),
  entity_id: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuery>;

@Injectable()
export class AuditService {
  /**
   * R42. Only the auditor and the administrator get this far, and the row
   * policy says the same thing again in the database, so a mistake in the
   * controller does not open the log to anyone else.
   */
  async list(query: AuditLogQuery): Promise<AuditLogEntry[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();

    const filters = [
      query.entity_type ? eq(schema.auditLog.entityType, query.entity_type) : undefined,
      query.entity_id ? eq(schema.auditLog.entityId, query.entity_id) : undefined,
    ].filter((f) => f !== undefined);

    const rows = await tx.db
      .select()
      .from(schema.auditLog)
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(schema.auditLog.id))
      .limit(query.limit);

    return rows.map((row) =>
      AuditLogEntry.parse({
        id: Number(row.id),
        actorId: row.actorId,
        entityType: row.entityType,
        entityId: row.entityId,
        action: row.action,
        before: row.before ?? null,
        after: row.after ?? null,
        at: row.at.toISOString(),
        ip: row.ip,
        orgUnitId: row.orgUnitId,
      }),
    );
  }
}
