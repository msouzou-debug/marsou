/**
 * The seam a budget code list arrives through — R15's `CostSource`
 * (`apps/api/src/cost/source/cost-source.ts`) at a much smaller scale.
 * eFinance's own capital budget codes number twenty, not thousands, so a
 * reader hands back the whole list at once rather than streaming rows.
 *
 * `BudgetCodesService.sync` asks a reader for the list and does not care
 * whether it came from the twenty rows eCapital ships (`SeedBudgetCodeReader`)
 * or from eFinance's own `GET /api/v1/master/budget-codes?kind=capex`
 * (`EFinanceBudgetCodeReader`, ADR-0022). When eFinance's read endpoint
 * actually exists in production, the work is in the second file and nowhere
 * else — if it turns out to be in three other files as well, the seam was
 * wrong (same discipline `sap-mcp.reader.ts`'s header comment states for R15).
 */
import type { BudgetCodeSource } from "@ecapital/shared";

/** One row as a reader hands it back, before it becomes a database write. */
export interface RawBudgetCode {
  code: string;
  descriptionEl: string;
  descriptionEn: string;
  category: string | null;
  isCapex: boolean;
}

export interface BudgetCodeSourceReader {
  /** What `budget_code.source` records for rows this reader produced. */
  readonly source: BudgetCodeSource;
  read(): Promise<RawBudgetCode[]>;
}
