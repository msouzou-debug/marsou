/**
 * R15 — the seam SAP arrives through.
 *
 * CAPEX-01 §7: "Phase 1: the user drops the monthly extract files … Phase 2:
 * swap the file reader for the SAP MCP interface behind the same `CostSource`
 * interface. Nothing above the interface changes."
 *
 * So nothing above this file knows about files. The pipeline asks a reader
 * for rows and gets an async iterable of `RawCostRow`; whether those rows came
 * out of an .xlsx a clerk uploaded, a .csv, or a remote call is the reader's
 * business alone. `payload` is opaque on the way through — the controller
 * that received an upload is the only thing that ever looks inside it, and it
 * hands the reader a value that reader understands.
 *
 * A row that cannot be read is still a row. It comes back with its problems
 * attached rather than throwing, because one unreadable amount in a
 * three-thousand-line extract must not cost the other two thousand
 * nine hundred and ninety-nine (CAPEX-03 §5 takes the same line).
 */
import type { CostSource, CostTxnType, SapReport } from "@ecapital/shared";

/** What a reader was asked for. `payload` is the reader's own currency. */
export interface CostSourceRequest {
  report: SapReport;
  /** YYYY-MM. The accounting period the extract belongs to. */
  period: string;
  payload: unknown;
}

/** A rule the reader could not satisfy on one row. */
export interface RawRowProblem {
  /** `import_exception.rule` — one of the names migration 0011 allows. */
  rule: "ROW_UNREADABLE" | "AMOUNT_UNREADABLE" | "DATE_UNREADABLE" | "COLUMN_MISSING";
  /** The cell as it was read, never coerced. */
  value: string | null;
  /** Key under `import.cost` in src/i18n/{el,en}.json. */
  messageKey: string;
  params: Record<string, string>;
}

/**
 * One line of a SAP extract, in the vocabulary of `packages/shared`'s
 * `CostTxn` and nothing else. Money is a number in EUR with the sign the
 * ledger wants: a credit is negative (CAPEX-01 §12).
 */
export interface RawCostRow {
  /** The line's number in the source, so an exception can be found again. */
  rowNo: number;
  /** The SAP document reference — purchase order plus item, or document number. */
  sourceRef: string;
  docDate: string | null;
  postingDate: string | null;
  amount: number | null;
  description: string;
  vendorName: string | null;
  sapWbs: string | null;
  sapPo: string | null;
  costCentre: string | null;
  glAccount: string | null;
  problems: RawRowProblem[];
}

export interface CostSourceReader {
  /** What `import_batch.source` records for rows this reader produced. */
  readonly source: CostSource;
  read(input: CostSourceRequest): AsyncIterable<RawCostRow>;
}

/** Which ledger each report writes (CAPEX-01 §7). */
export const TXN_TYPE_BY_REPORT: Record<SapReport, CostTxnType> = {
  // ME2N lists what is still owed on a purchase order: a commitment.
  ME2N: "COMMITMENT",
  // KSB1 is cost-centre line items and FBL1N is vendor line items. Both are
  // money that has been posted, so both are actuals.
  KSB1: "ACTUAL",
  FBL1N: "ACTUAL",
};
