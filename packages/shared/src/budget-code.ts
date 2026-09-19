import { z } from "zod";

// ADR-0025, owner decision 19/09/2026: one CAPEX budget code per contract,
// chosen from eFinance's CAPEX budget codes. eCapital carries a reference
// table of them (migration 0013) until eFinance's own
// `GET /api/v1/master/budget-codes?kind=capex` exists to read live from
// (INTEGRATION-eFinance-eMAP-eCapital.md §5).

export const BudgetCodeSource = z.enum(["SEED", "EFINANCE"]);
export type BudgetCodeSource = z.infer<typeof BudgetCodeSource>;

export const BudgetCode = z.object({
  code: z.string(),
  descriptionEl: z.string(),
  descriptionEn: z.string(),
  category: z.string().nullable(),
  isCapex: z.boolean(),
  active: z.boolean(),
  // Where this row's text last came from: the seed this migration wrote, or
  // eFinance's own sync. `null` synced_at means no sync has ever touched it.
  source: BudgetCodeSource,
  syncedAt: z.string().nullable(),
});
export type BudgetCode = z.infer<typeof BudgetCode>;

// GET /budget-codes?kind=capex — any signed-in role.
export const BudgetCodeList = z.object({
  items: z.array(BudgetCode),
});
export type BudgetCodeList = z.infer<typeof BudgetCodeList>;

// POST /budget-codes/sync — admin or finance only. What the sync did, so the
// screen that triggers it (or, for now, a script) can say something more
// useful than "done".
export const BudgetCodeSyncResult = z.object({
  source: BudgetCodeSource,
  upserted: z.number().int().nonnegative(),
  deactivated: z.number().int().nonnegative(),
  syncedAt: z.string(),
});
export type BudgetCodeSyncResult = z.infer<typeof BudgetCodeSyncResult>;
