/**
 * R15 — phase two of the SAP seam, present and deliberately empty.
 *
 * CAPEX-01 §1: "SAP is file-extract first, MCP interface later. Build the
 * ingestion layer so the source is swappable." This class is how that claim
 * is checked rather than asserted: it implements `CostSourceReader`, it is
 * registered beside `SapExtractReader`, and the pipeline reaches it through
 * the same call. What it does not have is a server to talk to, so it says so
 * in the caller's language and stops.
 *
 * When the MCP interface exists, the work is in this file and nowhere else.
 * If it turns out to be in three other files as well, the seam was wrong.
 */
import type { CostSource } from "@ecapital/shared";
import { AppError } from "../../common/errors";
import type { CostSourceReader, CostSourceRequest, RawCostRow } from "./cost-source";

export class SapMcpReader implements CostSourceReader {
  readonly source: CostSource = "SAP_MCP";

  async *read(_input: CostSourceRequest): AsyncIterable<RawCostRow> {
    throw AppError.unprocessable("errors.costSourceNotConfigured");
    // Unreachable, and here so the signature is an async generator like the
    // file reader's rather than a promise that happens to look like one.
    yield await Promise.reject(new Error("unreachable"));
  }
}
