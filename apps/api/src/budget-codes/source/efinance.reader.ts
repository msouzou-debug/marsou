/**
 * Phase two of the budget-code seam, live from the day eFinance's read
 * endpoint answers — ADR-0022's loopback contract and
 * INTEGRATION-eFinance-eMAP-eCapital.md §5.
 *
 * `BudgetCodesService` picks this reader over `SeedBudgetCodeReader` only
 * when both `EFINANCE_URL` and `EFINANCE_TOKEN` are set (ADR-0025's own
 * fallback rule); the call itself always goes to the loopback address ADR-
 * 0022 fixes, `http://127.0.0.1:5004`, never to `EFINANCE_URL` — that
 * setting is the public hostname `LinksController` uses for a human's
 * «Άνοιγμα στο eFinance» link, a different address for a different caller.
 *
 * ADR-0022's rules this reader follows: one bearer token, no forwarded-edge
 * header (there is nothing to forward — this request is built from scratch),
 * a 5-second timeout, and the one error envelope `{"error":{"code",
 * "message"}}` every route on the contract answers with. `NO_PROXY` is a
 * host-level setting on the systemd unit (ADR-0022 §"Bypassing Squid"), not
 * something this file has to arrange — a plain `fetch` is exactly what a
 * unit with `NO_PROXY=127.0.0.1,localhost` in its environment needs.
 */
import { AppError } from "../../common/errors";
import type { BudgetCodeSource } from "@ecapital/shared";
import type { BudgetCodeSourceReader, RawBudgetCode } from "./budget-code-source";

/** ADR-0022: eFinance's loopback contract, same host, eCapital the only caller. */
export const EFINANCE_LOOPBACK_URL = "http://127.0.0.1:5004";
const TIMEOUT_MS = 5_000;

/** The shape docs/INTEGRATION-eFinance-eMAP-eCapital.md §5 promises for this route. */
interface EFinanceBudgetCodeRow {
  code: string;
  description_el?: string;
  description_en?: string;
  category?: string | null;
}

interface EFinanceErrorEnvelope {
  error?: { code?: string; message?: string };
}

export class EFinanceBudgetCodeReader implements BudgetCodeSourceReader {
  readonly source: BudgetCodeSource = "EFINANCE";

  constructor(private readonly token: string) {}

  async read(): Promise<RawBudgetCode[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${EFINANCE_LOOPBACK_URL}/api/v1/master/budget-codes?kind=capex`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
    } catch (error) {
      // Network failure, refused connection, or the 5-second timeout firing
      // (AbortError lands here too). eFinance being unreachable is not the
      // caller's fault, but it is also not something to guess an answer for.
      const detail = error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
      throw AppError.unprocessable("errors.budgetCodeSyncFailed", { detail });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const envelope = (await response.json().catch(() => null)) as EFinanceErrorEnvelope | null;
      throw AppError.unprocessable("errors.budgetCodeSyncFailed", {
        detail: envelope?.error?.message ?? String(response.status),
      });
    }

    const body = (await response.json().catch(() => null)) as
      | EFinanceBudgetCodeRow[]
      | { items?: EFinanceBudgetCodeRow[] }
      | null;
    const rows = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : null;
    if (!rows) throw AppError.unprocessable("errors.budgetCodeSyncFailed", { detail: "shape" });

    return rows
      .filter((row): row is EFinanceBudgetCodeRow => typeof row?.code === "string" && row.code.length > 0)
      .map((row) => ({
        code: row.code,
        descriptionEl: row.description_el ?? "",
        descriptionEn: row.description_en ?? "",
        category: row.category ?? null,
        // §5's route is already scoped `?kind=capex`; every row it returns
        // is the capital subset by construction.
        isCapex: true,
      }));
  }
}
