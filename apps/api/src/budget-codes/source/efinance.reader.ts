/**
 * Phase two of the budget-code seam: eFinance's own
 * `GET /api/v1/master/budget-codes?kind=capex`, live since 21/09/2026
 * (eFinance's integration record §3; ADR-0022, ADR-0025, ADR-0029).
 *
 * The call itself is the EFinanceClient's — the one place that knows the
 * loopback address, the bearer token, the 5-second read timeout and the
 * error envelope. This reader only turns eFinance's rows into eCapital's:
 *
 *   - the display name is `name` when eFinance sends one, `description`
 *     otherwise (owner decision, 02/10/2026). eFinance holds one text per
 *     code, so it fills both languages; the seed's English stays only on the
 *     rows eFinance does not send.
 *   - `category` is kept as eFinance spells it («Εξοπλισμός»).
 *   - a row eFinance marks inactive is left out, so the sync deactivates it
 *     here too.
 *
 * Anything that goes wrong on the way is still `errors.budgetCodeSyncFailed`,
 * 422, with eFinance's own code in the detail — the behaviour this reader had
 * before the client existed.
 */
import { AppError } from "../../common/errors";
import type { BudgetCodeSource } from "@ecapital/shared";
import { EFinanceClient, EFinanceError } from "../../efinance/efinance-client";
import type { BudgetCodeSourceReader, RawBudgetCode } from "./budget-code-source";

export { EFINANCE_LOOPBACK_URL } from "../../efinance/efinance-client";

export class EFinanceBudgetCodeReader implements BudgetCodeSourceReader {
  readonly source: BudgetCodeSource = "EFINANCE";

  constructor(private readonly client: EFinanceClient) {}

  async read(): Promise<RawBudgetCode[]> {
    let rows;
    try {
      rows = await this.client.budgetCodes("capex");
    } catch (error) {
      if (error instanceof EFinanceError) {
        throw AppError.unprocessable("errors.budgetCodeSyncFailed", { detail: error.summary });
      }
      throw error;
    }

    return rows
      .filter((row) => row.code.length > 0 && row.active)
      .map((row) => {
        const display = row.name?.trim() || row.description?.trim() || row.code;
        return {
          code: row.code,
          descriptionEl: display,
          descriptionEn: display,
          category: row.category ?? null,
          // The route is asked `kind=capex`; every row is the capital subset.
          isCapex: row.kind === "capex",
        };
      });
  }
}
