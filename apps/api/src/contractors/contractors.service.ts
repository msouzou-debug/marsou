import { Injectable } from "@nestjs/common";
import type { Contractor, ContractorCreate } from "@ecapital/shared";
import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import {
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import type { ContractorUpdate } from "./contractor-write";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R08 — the supplier register. One list for the whole organisation: the same
 * company holds contracts at Larnaca and at Paphos, and two rows for it would
 * make every contractor report wrong.
 *
 * There is no permission check in this file and there is not meant to be one
 * (ADR-0010), with one exception that is a rule and not an access decision:
 * `blacklisted` is an organisation-wide judgement, so only an administrator
 * may move it, and the service says so before the policy gets a chance to
 * allow it.
 */
@Injectable()
export class ContractorsService {
  async list(): Promise<Contractor[]> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select()
      .from(schema.contractor)
      .orderBy(asc(schema.contractor.name));
    return rows.map(toContractor);
  }

  async create(input: ContractorCreate): Promise<Contractor> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    try {
      const [row] = await tx.db
        .insert(schema.contractor)
        .values({
          name: input.name,
          vatNumber: input.vatNumber,
          registrationNo: input.registrationNo,
          category: input.category,
          sapVendorId: input.sapVendorId,
          blacklisted: false,
        })
        .returning();
      return toContractor(row);
    } catch (error) {
      const state = sqlState(error);
      if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (state === UNIQUE_VIOLATION) {
        throw AppError.unprocessable("errors.contractorNameTaken", { name: input.name });
      }
      throw error;
    }
  }

  /**
   * RULE (R08): a blacklisted contractor takes no new contract anywhere in
   * the organisation, so the flag is an administrator's to set. A head of
   * estates may correct a VAT number or a category and is refused the flag
   * with errors.blacklistAdminOnly.
   */
  async update(id: string, input: ContractorUpdate): Promise<Contractor> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const existing = await this.load(id);

    const changingBlacklist =
      input.blacklisted !== undefined && input.blacklisted !== existing.blacklisted;
    if (changingBlacklist && !(tx.context.roles ?? []).includes("admin")) {
      throw AppError.forbidden("errors.blacklistAdminOnly");
    }

    const values = pruned({
      name: input.name,
      vatNumber: input.vatNumber,
      registrationNo: input.registrationNo,
      category: input.category,
      sapVendorId: input.sapVendorId,
      blacklisted: input.blacklisted,
    });
    if (Object.keys(values).length === 0) return existing;

    try {
      const touched = await tx.db
        .update(schema.contractor)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.contractor.id, id))
        .returning();
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      return toContractor(touched[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const state = sqlState(error);
      if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (state === UNIQUE_VIOLATION) {
        throw AppError.unprocessable("errors.contractorNameTaken", { name: input.name ?? "" });
      }
      throw error;
    }
  }

  /** The row, or 404. Every signed-in user may read the supplier register. */
  async load(id: string): Promise<Contractor> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    if (!UUID.test(id)) throw AppError.notFound("errors.contractorNotFound");
    const rows = await tx.db
      .select()
      .from(schema.contractor)
      .where(eq(schema.contractor.id, id))
      .limit(1);
    if (!rows.length) throw AppError.notFound("errors.contractorNotFound");
    return toContractor(rows[0]);
  }
}

export function toContractor(row: typeof schema.contractor.$inferSelect): Contractor {
  return {
    id: row.id,
    name: row.name,
    vatNumber: row.vatNumber,
    registrationNo: row.registrationNo,
    category: row.category,
    sapVendorId: row.sapVendorId,
    blacklisted: row.blacklisted,
  };
}

/** Drop the keys the caller did not send, so a PATCH touches only what it names. */
function pruned<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
