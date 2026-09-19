/**
 * Who is making this request, as a row id, and the uuid guard every `:id`
 * goes through before it reaches a query.
 *
 * The RLS interceptor puts the caller's Entra subject on the transaction
 * (ADR-0010); the tables point at `app_user.id`, so the two have to be joined
 * up once per write. There is no permission check here and there is not meant
 * to be one — this only says who, never whether.
 */
import { eq } from "drizzle-orm";
import { AppError } from "./errors";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function callerUserId(): Promise<string> {
  const tx = currentTx();
  if (!tx) throw AppError.internal();
  const rows = await tx.db
    .select({ id: schema.appUser.id })
    .from(schema.appUser)
    .where(eq(schema.appUser.subject, tx.context.userId))
    .limit(1);
  // The token verified, so the subject is real; a missing row means the seed
  // and the directory have drifted, which is not the caller's fault.
  if (!rows.length) throw AppError.internal();
  return rows[0].id;
}
