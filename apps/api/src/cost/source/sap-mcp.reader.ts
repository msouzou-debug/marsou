/**
 * R15 — phase two of the SAP seam: SAP administration's connector
 * (ADR-0036 §1).
 *
 * CAPEX-01 §1: "SAP is file-extract first, MCP interface later. Build the
 * ingestion layer so the source is swappable." This class is that swap. It
 * implements `CostSourceReader` beside `SapExtractReader`, it asks the
 * connector for the same export a clerk would otherwise download, and it
 * reads the answer with the same profile (`capexlines.yaml`) and the same
 * code (`rowsOfFile`). Nothing above the interface knows which one ran.
 *
 * Configuration: `SAP_CONNECTOR_URL` and `SAP_CONNECTOR_KEY`, both optional.
 * Without both, the reader says it has nothing to talk to
 * (errors.costSourceNotConfigured), exactly as it did before the connector
 * existed. The key is placed on the server file to file like the eArchive
 * token (ADR-0036, Consequences); it is never logged, never put in an error
 * and never in the repository.
 *
 * ASSUMPTION (ADR-0036; SAP administration's answer of 23/11/2026 named the
 * file route `/v1/export/capexlines` and nothing else about the call):
 *  - the request is `GET ${SAP_CONNECTOR_URL}/v1/export/capexlines` with the
 *    query `fiscalYear`, `periodFrom`, `periodTo` and `format=csv`;
 *  - the key travels as `Authorization: Bearer <key>`;
 *  - the answer is the CSV the file export would have been, header row
 *    first, with the columns SAP administration listed.
 * The query names and the header are ours, not theirs; when SAP
 * administration confirms or corrects them, the change is in `request()`
 * below and nowhere else.
 */
import { HttpStatus } from "@nestjs/common";
import type { CostSource } from "@ecapital/shared";
import { AppError } from "../../common/errors";
import { assertReportActive, type CostSourceReader, type CostSourceRequest, type RawCostRow } from "./cost-source";
import { rowsOfFile } from "./sap-extract.reader";
import { loadSapProfile } from "./sap-profile";

/** What the connector route hands this reader: one fiscal year, a period range. */
export interface SapConnectorPayload {
  fiscalYear: number;
  /** SAP posting periods, 1–16 (13–16 are the special periods after year end). */
  periodFrom: number;
  periodTo: number;
}

export interface SapMcpReaderOptions {
  url?: string;
  key?: string;
  timeoutMs?: number;
}

/** A month of capital lines for twelve company codes is small; a minute is generous. */
export const SAP_CONNECTOR_TIMEOUT_MS = 60_000;

/** The route SAP administration named (23/11/2026). */
export const SAP_CONNECTOR_EXPORT_PATH = "/v1/export/capexlines";

function isPayload(value: unknown): value is SapConnectorPayload {
  if (typeof value !== "object" || value === null) return false;
  const p = value as SapConnectorPayload;
  return [p.fiscalYear, p.periodFrom, p.periodTo].every((n) => Number.isInteger(n));
}

/** A key that has actually been placed: not unset, not blank, not the template's CHANGE-ME. */
function keyPlaced(key: string | undefined): key is string {
  const value = key?.trim();
  return Boolean(value) && value !== "CHANGE-ME";
}

export class SapMcpReader implements CostSourceReader {
  readonly source: CostSource = "SAP_MCP";
  readonly configured: boolean;
  private readonly url: string | null;
  private readonly key: string | null;
  private readonly timeoutMs: number;

  constructor(options: SapMcpReaderOptions = {}) {
    const url = options.url?.trim().replace(/\/+$/, "") ?? "";
    this.configured = url !== "" && keyPlaced(options.key);
    this.url = this.configured ? url : null;
    this.key = this.configured ? (options.key as string).trim() : null;
    this.timeoutMs = options.timeoutMs ?? SAP_CONNECTOR_TIMEOUT_MS;
  }

  async *read(input: CostSourceRequest): AsyncIterable<RawCostRow> {
    assertReportActive(input.report);
    // The connector serves the capital lines and nothing else; an FBL1N is a
    // file a clerk uploads until it is retired in its turn.
    if (!this.configured || input.report !== "CAPEX_LINES") {
      throw AppError.unprocessable("errors.costSourceNotConfigured");
    }
    if (!isPayload(input.payload)) throw AppError.badRequest("errors.sapConnectorQueryNotValid");
    const content = await this.request(input.payload);
    yield* rowsOfFile({ fileName: "capexlines.csv", content }, loadSapProfile("CAPEX_LINES"));
  }

  /** One GET, the CSV back as bytes. See the ASSUMPTION in the file header. */
  private async request(payload: SapConnectorPayload): Promise<Buffer> {
    const url = new URL(`${this.url}${SAP_CONNECTOR_EXPORT_PATH}`);
    url.searchParams.set("fiscalYear", String(payload.fiscalYear));
    url.searchParams.set("periodFrom", String(payload.periodFrom));
    url.searchParams.set("periodTo", String(payload.periodTo));
    url.searchParams.set("format", "csv");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let body: Buffer;
    try {
      // Built from scratch: the key and an Accept, nothing from an inbound request.
      response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.key}`, Accept: "text/csv" },
        signal: controller.signal,
      });
      body = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw connectorFailed(aborted ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timer);
    }
    // The status only: an error body could echo the request back, key and all.
    if (!response.ok) throw connectorFailed(`HTTP_${response.status}`);
    return body;
  }
}

/** The connector said no or did not answer: 502, the fault is upstream. */
function connectorFailed(code: string): AppError {
  return new AppError("errors.sapConnectorFailed", HttpStatus.BAD_GATEWAY, { code });
}
