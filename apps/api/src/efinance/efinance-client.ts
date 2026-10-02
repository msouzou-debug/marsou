/**
 * The eFinance client — one typed client over `fetch` for every route in
 * eFinance's integration record (docs/integration/eFinance-integration-
 * record.md), ADR-0022's loopback contract and ADR-0029.
 *
 * The rules it keeps, all from the record:
 *
 *  - `http://127.0.0.1:5004` (EFINANCE_API_URL), one bearer token
 *    (EFINANCE_TOKEN), and nothing else on the request: every call is built
 *    from scratch, so no forwarded-edge header from an inbound request can
 *    ride along (eFinance refuses those with 403 even from loopback).
 *  - 5 seconds for a read, 10 for the one write.
 *  - One error envelope, `{"error":{"code","message"}}`, mapped to an
 *    `EFinanceError` (an AppError) that carries eFinance's own code. A
 *    timeout, a refused connection and an unreadable body get codes of their
 *    own (TIMEOUT, NETWORK, BAD_RESPONSE) so a caller can tell "eFinance said
 *    no" from "eFinance did not answer".
 *  - Money stays a 2-decimal string here and an unknown amount stays null.
 *    Turning it into a number is the edge's job (`toAmount`), once.
 *
 * With EFINANCE_TOKEN unset, blank or the template's CHANGE-ME the client
 * reports `configured: false`. Every caller checks that first and degrades to
 * "not configured" without throwing — the same hold the eArchive sender
 * keeps (ADR-0023 §4). Calling a route anyway throws NOT_CONFIGURED.
 */
import { HttpStatus } from "@nestjs/common";
import {
  EFinanceErrorEnvelope,
  EFinanceRawBudgetCode,
  EFinanceRawBudgetPositionRow,
  EFinanceRawContractSpend,
  EFinanceRawCostCentre,
  EFinanceRawEntity,
  EFinanceRawInvoice,
  EFinanceRawRequisition,
  EFinanceRawVendor,
  type EFinanceContractPut,
} from "@ecapital/shared";
import { z, type ZodType } from "zod";
import { AppError } from "../common/errors";
import type { AppConfig } from "../config";

/** ADR-0022: eFinance's loopback contract, same host, eCapital the only caller. */
export const EFINANCE_LOOPBACK_URL = "http://127.0.0.1:5004";
export const READ_TIMEOUT_MS = 5_000;
export const WRITE_TIMEOUT_MS = 10_000;
/** Record §2: `limit` defaults to 200 and tops out at 500. */
export const PAGE_LIMIT = 500;

/** eFinance's own codes, plus the four this side adds for a call that never got an answer. */
export type EFinanceFailure =
  | "UNAUTHENTICATED"
  | "LOOPBACK_ONLY"
  | "NOT_FOUND"
  | "SCHEMA_INVALID"
  | "CONFLICT"
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_RESPONSE"
  | "NOT_CONFIGURED"
  | string;

/**
 * eFinance said no, or did not answer. An AppError, so a route that lets it
 * through answers in the caller's language (`errors.efinanceFailed`), 502:
 * the fault is upstream, not in the request.
 */
export class EFinanceError extends AppError {
  constructor(
    readonly code: EFinanceFailure,
    readonly detail: string,
    readonly upstreamStatus: number | null = null,
  ) {
    super("errors.efinanceFailed", HttpStatus.BAD_GATEWAY, { code, detail });
  }

  /** What `efinance_last_error` and the sync state store: `CODE: message`. */
  get summary(): string {
    return this.detail ? `${this.code}: ${this.detail}` : this.code;
  }

  /** A refusal that sending again will not mend (record §4: 409 is for a person). */
  get final(): boolean {
    return this.code === "CONFLICT" || this.code === "SCHEMA_INVALID";
  }
}

/** True for a token that has actually been placed: not unset, not blank, not the template's CHANGE-ME. */
export function tokenPlaced(token: string | undefined): token is string {
  const value = token?.trim();
  return Boolean(value) && value !== "CHANGE-ME";
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BudgetPositionAnswer {
  items: z.infer<typeof EFinanceRawBudgetPositionRow>[];
  asOf: string | null;
}

/** A list answer: `{items, next_cursor}` per the record, or a bare array. */
function pageOf<T extends ZodType>(item: T) {
  return z.union([
    z.object({
      items: z.array(item),
      next_cursor: z.string().nullable().optional(),
    }),
    z.array(item).transform((items) => ({ items, next_cursor: null })),
  ]);
}

const BudgetPositionBody = z.union([
  z.object({
    items: z.array(EFinanceRawBudgetPositionRow),
    as_of: z.string().nullable().optional(),
  }),
  z.array(EFinanceRawBudgetPositionRow).transform((items) => ({ items, as_of: null })),
]);

export interface EFinanceClientOptions {
  baseUrl?: string;
  readTimeoutMs?: number;
  writeTimeoutMs?: number;
}

export class EFinanceClient {
  readonly configured: boolean;
  private readonly token: string | null;
  private readonly baseUrl: string;
  private readonly readTimeoutMs: number;
  private readonly writeTimeoutMs: number;

  constructor(token: string | undefined, options: EFinanceClientOptions = {}) {
    this.configured = tokenPlaced(token);
    this.token = this.configured ? (token as string).trim() : null;
    this.baseUrl = (options.baseUrl ?? EFINANCE_LOOPBACK_URL).replace(/\/+$/, "");
    this.readTimeoutMs = options.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.writeTimeoutMs = options.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
  }

  static fromConfig(config: AppConfig): EFinanceClient {
    return new EFinanceClient(config.EFINANCE_TOKEN, { baseUrl: config.EFINANCE_API_URL });
  }

  // ------------------------------------------------------------- master --

  entities(): Promise<z.infer<typeof EFinanceRawEntity>[]> {
    return this.all("/api/v1/master/entities", {}, EFinanceRawEntity);
  }

  /** `entity` accepts either code form (record §3). */
  costCentres(entity?: string): Promise<z.infer<typeof EFinanceRawCostCentre>[]> {
    return this.all("/api/v1/master/cost-centres", { entity }, EFinanceRawCostCentre);
  }

  budgetCodes(kind?: "capex" | "opex"): Promise<z.infer<typeof EFinanceRawBudgetCode>[]> {
    return this.all("/api/v1/master/budget-codes", { kind }, EFinanceRawBudgetCode);
  }

  vendorsPage(cursor?: string | null, limit = PAGE_LIMIT): Promise<Page<z.infer<typeof EFinanceRawVendor>>> {
    return this.page("/api/v1/master/vendors", { cursor: cursor ?? undefined, limit: String(limit) }, EFinanceRawVendor);
  }

  vendors(): Promise<z.infer<typeof EFinanceRawVendor>[]> {
    return this.all("/api/v1/master/vendors", {}, EFinanceRawVendor);
  }

  // ------------------------------------------------------------- budget --

  /** Capital codes only, per (budget_code, entity_code), with `as_of`. */
  async budgetPosition(query: { year: number; entity?: string; code?: string }): Promise<BudgetPositionAnswer> {
    const body = await this.request("GET", "/api/v1/budget/position", {
      year: String(query.year),
      entity: query.entity,
      code: query.code,
    });
    const parsed = parse(BudgetPositionBody, body);
    return { items: parsed.items, asOf: parsed.as_of ?? null };
  }

  // ------------------------------------------------------------ capital --

  invoicesByRef(capRef: string): Promise<z.infer<typeof EFinanceRawInvoice>[]> {
    return this.all("/api/v1/capital/invoices", { ref: capRef }, EFinanceRawInvoice);
  }

  invoicesSince(updatedSince: string, cursor?: string | null): Promise<Page<z.infer<typeof EFinanceRawInvoice>>> {
    return this.page(
      "/api/v1/capital/invoices",
      { updated_since: updatedSince, cursor: cursor ?? undefined, limit: String(PAGE_LIMIT) },
      EFinanceRawInvoice,
    );
  }

  requisitionsByRef(capRef: string): Promise<z.infer<typeof EFinanceRawRequisition>[]> {
    return this.all("/api/v1/capital/requisitions", { ref: capRef }, EFinanceRawRequisition);
  }

  requisitionsSince(
    updatedSince: string,
    cursor?: string | null,
  ): Promise<Page<z.infer<typeof EFinanceRawRequisition>>> {
    return this.page(
      "/api/v1/capital/requisitions",
      { updated_since: updatedSince, cursor: cursor ?? undefined, limit: String(PAGE_LIMIT) },
      EFinanceRawRequisition,
    );
  }

  /** Record §4, the one write. 409 CONFLICT when the hospital or the budget code moved. */
  async putContract(capRef: string, body: EFinanceContractPut): Promise<z.infer<typeof EFinanceRawContractSpend>> {
    const answer = await this.request(
      "PUT",
      `/api/v1/capital/contracts/${encodeURIComponent(capRef)}`,
      {},
      body,
      this.writeTimeoutMs,
    );
    return parse(EFinanceRawContractSpend, answer);
  }

  /** The stored copy plus the same spend figures. 404 NOT_FOUND if never pushed. */
  async getContract(capRef: string): Promise<z.infer<typeof EFinanceRawContractSpend>> {
    const answer = await this.request("GET", `/api/v1/capital/contracts/${encodeURIComponent(capRef)}`, {});
    return parse(EFinanceRawContractSpend, answer);
  }

  // ---------------------------------------------------------- internals --

  private async page<T extends ZodType>(
    path: string,
    query: Record<string, string | undefined>,
    item: T,
  ): Promise<Page<z.infer<T>>> {
    const body = await this.request("GET", path, query);
    const parsed = parse(pageOf(item), body) as { items: z.infer<T>[]; next_cursor?: string | null };
    return { items: parsed.items, nextCursor: parsed.next_cursor ?? null };
  }

  /** Every page, following `next_cursor` until it is null. */
  private async all<T extends ZodType>(
    path: string,
    query: Record<string, string | undefined>,
    item: T,
  ): Promise<z.infer<T>[]> {
    const items: z.infer<T>[] = [];
    let cursor: string | null = null;
    // A guard, not a limit anybody should reach: 6,148 vendors is 13 pages.
    for (let pageNo = 0; pageNo < 10_000; pageNo += 1) {
      const page: Page<z.infer<T>> = await this.page(
        path,
        { ...query, cursor: cursor ?? undefined, limit: String(PAGE_LIMIT) },
        item,
      );
      items.push(...page.items);
      if (!page.nextCursor || page.nextCursor === cursor) break;
      cursor = page.nextCursor;
    }
    return items;
  }

  private async request(
    method: "GET" | "PUT",
    path: string,
    query: Record<string, string | undefined>,
    body?: unknown,
    timeoutMs: number = this.readTimeoutMs,
  ): Promise<unknown> {
    if (!this.configured || !this.token) {
      throw new EFinanceError("NOT_CONFIGURED", "EFINANCE_TOKEN is not set");
    }
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    let text: string;
    try {
      // Built from scratch: the token, a content type for the write, and
      // nothing that came in on somebody else's request.
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/json",
      };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      text = await response.text();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      throw new EFinanceError(
        aborted ? "TIMEOUT" : "NETWORK",
        aborted ? `no answer within ${timeoutMs} ms` : messageOf(error),
      );
    } finally {
      clearTimeout(timer);
    }

    const json = readJson(text);
    if (!response.ok) {
      const envelope = EFinanceErrorEnvelope.safeParse(json);
      if (envelope.success) {
        throw new EFinanceError(envelope.data.error.code, envelope.data.error.message, response.status);
      }
      throw new EFinanceError(`HTTP_${response.status}`, text.slice(0, 200), response.status);
    }
    if (json === undefined) throw new EFinanceError("BAD_RESPONSE", "the body is not JSON", response.status);
    return json;
  }
}

function parse<T extends ZodType>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new EFinanceError("BAD_RESPONSE", `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "shape"}`);
  }
  return parsed.data;
}

function readJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) return cause.message;
    return error.message;
  }
  return String(error);
}

// ---------------------------------------------------------------- the edge --

/** Record §2 money, a 2-decimal string or null, as a number or null. Never null-as-zero. */
export function toAmount(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A number (or a numeric string from Postgres) as the record's 2-decimal string. */
export function toMoneyString(value: number | string): string {
  const amount = typeof value === "number" ? value : Number(value);
  return (Math.round(amount * 100) / 100).toFixed(2);
}

/** Record §2: ISO 8601 with an explicit `+00:00`. */
export function isoUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "+00:00").replace(/Z$/, "+00:00");
}
