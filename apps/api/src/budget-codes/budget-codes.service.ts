import { Inject, Injectable } from "@nestjs/common";
import type { BudgetCode, BudgetCodeList, BudgetCodeSyncResult } from "@ecapital/shared";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { AppError } from "../common/errors";
import { CONFIG, type AppConfig } from "../config";
import { currentTx } from "../db/client";
import * as schema from "../db/schema";
import { EFinanceBudgetCodeReader } from "./source/efinance.reader";
import type { BudgetCodeSourceReader } from "./source/budget-code-source";
import { SeedBudgetCodeReader } from "./source/seed.reader";

/**
 * ADR-0025 — the reference table `contract.budgetCode` points at.
 *
 * `list` is the plain read every signed-in role gets (S07a's select, S07's
 * facts list, S07e's optional column). `sync` is the admin/finance-only
 * write that refreshes the table from a `BudgetCodeSourceReader` — eFinance's
 * own `GET /api/v1/master/budget-codes?kind=capex` when it is configured
 * (`EFINANCE_URL` and `EFINANCE_TOKEN` both set), the twenty seeded rows
 * otherwise. Nothing here decides who may call `sync` at all; the route does
 * (`@Roles("admin", "finance")`) and the row policy does again underneath it
 * (migration 0013's `budget_code_write`).
 */
@Injectable()
export class BudgetCodesService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** GET /budget-codes?kind=capex. Active rows only — S07a offers nobody a
   * code eFinance (or this migration's own seed) has retired. */
  async list(): Promise<BudgetCodeList> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const rows = await tx.db
      .select(BUDGET_CODE_COLUMNS)
      .from(schema.budgetCode)
      .where(eq(schema.budgetCode.active, true))
      .orderBy(asc(schema.budgetCode.code));
    return { items: rows.map(toBudgetCode) };
  }

  /**
   * Which reader answers `POST /budget-codes/sync`. Both `EFINANCE_URL` and
   * `EFINANCE_TOKEN` have to be set — the same "is eFinance configured at
   * all" test `LinksController` uses for the human-facing link, plus the
   * token this loopback call actually authenticates with. Either missing and
   * the fallback is eCapital's own seed, which is always safe to run.
   */
  private reader(): BudgetCodeSourceReader {
    const { EFINANCE_URL, EFINANCE_TOKEN, EFINANCE_API_URL } = this.config;
    if (EFINANCE_URL && EFINANCE_TOKEN) return new EFinanceBudgetCodeReader(EFINANCE_TOKEN, EFINANCE_API_URL);
    return new SeedBudgetCodeReader();
  }

  /**
   * Upserts every row the reader hands back, by code, and marks whatever was
   * active before and is not in that list `active = false` — CAPEX-03 §5's
   * own discipline for a row an import no longer sees, applied to a
   * reference table instead of a cost extract. A code a contract already
   * points at is never deleted (migration 0013's `on delete restrict`); it
   * is only ever deactivated, which stops it being offered on a new contract
   * without disturbing the one that already carries it.
   */
  async sync(): Promise<BudgetCodeSyncResult> {
    const tx = currentTx();
    if (!tx) throw AppError.internal();
    const reader = this.reader();
    const rows = await reader.read();
    const now = new Date();

    for (const row of rows) {
      await tx.db
        .insert(schema.budgetCode)
        .values({
          code: row.code,
          descriptionEl: row.descriptionEl,
          descriptionEn: row.descriptionEn,
          category: row.category,
          isCapex: row.isCapex,
          active: true,
          source: reader.source,
          syncedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.budgetCode.code,
          set: {
            descriptionEl: row.descriptionEl,
            descriptionEn: row.descriptionEn,
            category: row.category,
            isCapex: row.isCapex,
            active: true,
            source: reader.source,
            syncedAt: now,
            updatedAt: now,
          },
        });
    }

    const codes = rows.map((row) => row.code);
    const deactivated = codes.length
      ? await tx.db
          .update(schema.budgetCode)
          .set({ active: false, updatedAt: now })
          .where(and(eq(schema.budgetCode.active, true), notInArray(schema.budgetCode.code, codes)))
          .returning({ code: schema.budgetCode.code })
      : [];

    return {
      source: reader.source,
      upserted: rows.length,
      deactivated: deactivated.length,
      syncedAt: now.toISOString(),
    };
  }
}

const BUDGET_CODE_COLUMNS = {
  code: schema.budgetCode.code,
  descriptionEl: schema.budgetCode.descriptionEl,
  descriptionEn: schema.budgetCode.descriptionEn,
  category: schema.budgetCode.category,
  isCapex: schema.budgetCode.isCapex,
  active: schema.budgetCode.active,
  source: schema.budgetCode.source,
  syncedAt: schema.budgetCode.syncedAt,
};

type BudgetCodeRow = {
  code: string;
  descriptionEl: string;
  descriptionEn: string;
  category: string | null;
  isCapex: boolean;
  active: boolean;
  source: string;
  syncedAt: Date | null;
};

function toBudgetCode(row: BudgetCodeRow): BudgetCode {
  return {
    code: row.code,
    descriptionEl: row.descriptionEl,
    descriptionEn: row.descriptionEn,
    category: row.category,
    isCapex: row.isCapex,
    active: row.active,
    source: row.source === "EFINANCE" ? "EFINANCE" : "SEED",
    syncedAt: row.syncedAt ? row.syncedAt.toISOString() : null,
  };
}
