/**
 * The pure half of the eFinance integration: turning eFinance's answers into
 * eCapital's shapes, and the rules that are functions of a row. Kept out of
 * the services so they can be tested without a database or a server.
 */
import type {
  BudgetPosition,
  EFinanceContractSummary,
  EFinanceRawBudgetPositionRow,
  EFinanceRawContractSpend,
  EFinanceRawInvoice,
} from "@ecapital/shared";
import { isoUtc, toAmount } from "./efinance-client";

/** What `contract.efinance_spend` holds: eFinance's own strings, and when we read them. */
export interface StoredSpend {
  current_value: string | null;
  booked: string | null;
  in_flight: string | null;
  requisitions: string | null;
  remaining: string | null;
  fetched_at: string;
}

export function spendJson(answer: EFinanceRawContractSpend, at: Date = new Date()): StoredSpend {
  return {
    current_value: answer.current_value,
    booked: answer.spend.booked,
    in_flight: answer.spend.in_flight,
    requisitions: answer.spend.requisitions,
    remaining: answer.remaining,
    fetched_at: isoUtc(at),
  };
}

export interface ContractEFinanceRow {
  pushedAt: Date | string | null;
  lastError: string | null;
  spend: StoredSpend | null;
}

/**
 * RULE (ADR-0029, INTEGRATION §5): booked is spend, in flight is forecast
 * only, requisitions are eFinance's commitment and are never added to
 * eCapital's committed ledger. The figures are eFinance's own, as it last
 * answered for this contract; null wherever it has not answered, never zero.
 */
export function summaryOf(row: ContractEFinanceRow): EFinanceContractSummary {
  const spend = row.spend;
  return {
    pushedAt: row.pushedAt ? new Date(row.pushedAt).toISOString() : null,
    lastError: row.lastError,
    booked: toAmount(spend?.booked),
    inFlight: toAmount(spend?.in_flight),
    requisitions: toAmount(spend?.requisitions),
    remaining: toAmount(spend?.remaining),
    lastSyncAt: spend?.fetched_at ? new Date(spend.fetched_at).toISOString() : null,
  };
}

/**
 * A project's figure is the sum over its contracts — of those eFinance has a
 * figure for. A contract with none adds nothing and does not turn the sum
 * into zero; no contract with a figure leaves it null. `pushedAt` is the
 * latest push, `lastError` the first contract's error, `lastSyncAt` the
 * oldest read, because the project's figure is only as fresh as that.
 */
export function projectSummaryOf(rows: ContractEFinanceRow[]): EFinanceContractSummary {
  const summaries = rows.map(summaryOf);
  const sum = (pick: (s: EFinanceContractSummary) => number | null): number | null => {
    const values = summaries.map(pick).filter((value): value is number => value !== null);
    return values.length ? round2(values.reduce((a, b) => a + b, 0)) : null;
  };
  const pushed = summaries.map((s) => s.pushedAt).filter((v): v is string => v !== null).sort();
  const synced = summaries.map((s) => s.lastSyncAt).filter((v): v is string => v !== null).sort();
  return {
    pushedAt: pushed.length ? pushed[pushed.length - 1] : null,
    lastError: summaries.find((s) => s.lastError !== null)?.lastError ?? null,
    booked: sum((s) => s.booked),
    inFlight: sum((s) => s.inFlight),
    requisitions: sum((s) => s.requisitions),
    remaining: sum((s) => s.remaining),
    lastSyncAt: synced.length ? synced[0] : null,
  };
}

/** True when the stored error is eFinance's 409: the timer leaves it for a person. */
export function isConflict(lastError: string | null): boolean {
  return lastError !== null && lastError.startsWith("CONFLICT");
}

// ------------------------------------------------------- the cost ledger --

/** RULE (ADR-0029): `efinance:invoice:<id>:<line index>`, unique per project and source. */
export function lineSourceRef(invoiceId: string, index: number): string {
  return `efinance:invoice:${invoiceId}:${index}`;
}

export function invoiceSourcePrefix(invoiceId: string): string {
  return `efinance:invoice:${invoiceId}:`;
}

export interface ProjectedLine {
  sourceRef: string;
  amount: string;
  description: string | null;
  postingDate: string | null;
  docDate: string | null;
  vendorName: string | null;
  costCentre: string | null;
  glAccount: string | null;
  sapWbs: string | null;
}

/**
 * Which lines of an invoice become ACTUAL cost_txn rows.
 *
 * RULE (record §3): only `booked` is spend. `in_flight` is not spend yet,
 * `reversed` is not spend any more, `rejected` never was — all three project
 * to nothing, so re-projecting a reversed invoice removes what it booked.
 * Spend comes from the lines, never the header. A line with no amount
 * (`line_total` null) is not guessed at, and an invoice in a currency other
 * than euro is kept in the history but not posted: the ledger is EUR only.
 * `sap_batch_date` is the posting date (the cash-flow month); invoice_date
 * is never one.
 */
export function projectedLines(invoice: EFinanceRawInvoice): ProjectedLine[] {
  if (invoice.ledger !== "booked") return [];
  if (invoice.currency !== "EUR") return [];
  const lines: ProjectedLine[] = [];
  invoice.lines.forEach((line, index) => {
    if (line.line_total === null) return;
    lines.push({
      sourceRef: lineSourceRef(String(invoice.id), index),
      amount: line.line_total,
      description: line.descr ?? invoice.invoice_no,
      postingDate: dateOnly(invoice.sap_batch_date),
      docDate: dateOnly(invoice.invoice_date),
      vendorName: invoice.vendor_name,
      costCentre: line.cost_centre,
      glAccount: line.gl_account,
      sapWbs: line.wbs_code,
    });
  });
  return lines;
}

export function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

/** A quantity or a rate eFinance sent as a number or a string, as a number or null. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The later of two eFinance timestamps, compared as instants rather than as text. */
export function laterOf(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

// ------------------------------------------------------- budget position --

/**
 * INTEGRATION §5's mapping, one row per (code, entity, year). eFinance
 * should answer one row for the three filters it was given; if it answers
 * several the figures are summed, and a figure eFinance does not know stays
 * null rather than becoming zero.
 *
 * RULE: `inFlight` is shown and never counted as committed: `available` is
 * eFinance's `allocated − booked − requisitions`, passed through as it was
 * computed, not recomputed here.
 */
export function budgetPositionOf(
  rows: EFinanceRawBudgetPositionRow[],
  asOf: string | null,
  key: { budgetCode: string; entityCode: string; year: number },
): BudgetPosition {
  const sum = (pick: (row: EFinanceRawBudgetPositionRow) => string | null): number | null => {
    const values = rows.map((row) => toAmount(pick(row))).filter((v): v is number => v !== null);
    return values.length ? round2(values.reduce((a, b) => a + b, 0)) : null;
  };
  return {
    budgetCode: key.budgetCode,
    entityCode: key.entityCode,
    year: key.year,
    allocated: sum((row) => row.allocated),
    booked: sum((row) => row.booked),
    requisitions: sum((row) => row.requisitions),
    inFlight: sum((row) => row.in_flight),
    available: sum((row) => row.available),
    asOf,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
