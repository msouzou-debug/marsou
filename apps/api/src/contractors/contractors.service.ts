import { Injectable } from "@nestjs/common";
import type { Contractor, ContractorCreate } from "@ecapital/shared";
import { asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { AppError } from "../common/errors";
import {
  CHECK_VIOLATION,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  sqlState,
} from "../common/sql-error";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { ContractPushService } from "../efinance/contract-push.service";
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
  constructor(private readonly efinancePush: ContractPushService) {}

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
          // Owner UAT 25/11/2026: a contact typed by a user is MANUAL, and
          // the eFinance sync never overwrites it.
          contactName: blankToNull(input.contactName),
          contactEmail: blankToNull(input.contactEmail),
          contactPhone: blankToNull(input.contactPhone),
          contactSource: "MANUAL",
        })
        .returning();
      return toContractor(row);
    } catch (error) {
      const state = sqlState(error);
      if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (state === CHECK_VIOLATION) throw AppError.badRequest("errors.contractorContactNotValid");
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

    const values: Record<string, unknown> = pruned({
      name: input.name,
      vatNumber: input.vatNumber,
      registrationNo: input.registrationNo,
      category: input.category,
      sapVendorId: input.sapVendorId,
      blacklisted: input.blacklisted,
    });
    // RULE (owner, UAT 25/11/2026): a contact a user changes becomes theirs
    // (MANUAL), and the eFinance sync leaves it alone from then on. A value
    // sent unchanged is not a change, so saving the form for a VAT number
    // does not take an eFinance contact away from eFinance.
    let contactChanged = false;
    for (const key of ["contactName", "contactEmail", "contactPhone"] as const) {
      if (input[key] === undefined) continue;
      const next = blankToNull(input[key]);
      if (next !== (existing[key] ?? null)) {
        values[key] = next;
        contactChanged = true;
      }
    }
    if (contactChanged) {
      values.contactSource = "MANUAL";
      values.contactSyncedAt = null;
    }
    if (Object.keys(values).length === 0) return existing;

    try {
      const touched = await tx.db
        .update(schema.contractor)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(schema.contractor.id, id))
        .returning();
      if (!touched.length) throw AppError.forbidden("errors.readOnlyAccount");
      // ADR-0029: the SAP vendor code is the push's `vendor_code`.
      if (input.sapVendorId !== undefined && input.sapVendorId !== existing.sapVendorId) {
        await this.efinancePush.pushContractor(id);
      }
      return toContractor(touched[0]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const state = sqlState(error);
      if (state === INSUFFICIENT_PRIVILEGE) throw AppError.forbidden("errors.readOnlyAccount");
      if (state === CHECK_VIOLATION) throw AppError.badRequest("errors.contractorContactNotValid");
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
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    contactSource: row.contactSource,
    contactSyncedAt: row.contactSyncedAt ? row.contactSyncedAt.toISOString() : null,
  };
}

/** A blank contact field is no contact field. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Drop the keys the caller did not send, so a PATCH touches only what it names. */
function pruned<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
