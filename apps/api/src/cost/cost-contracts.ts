/**
 * The request and response shapes the cost module needs on top of
 * `packages/shared/src/cost.ts`.
 *
 * The shared file is the contract with the web app and is implemented
 * exactly: `ImportBatch`, `UnmatchedQueue`, `Allocation`, `ProjectCost`,
 * `PaymentCert`, `CashflowRow` and `AccrualRow` come from there and are not
 * redefined. What is here is the envelope around them — a list with its
 * total, the query strings, and the two places where a route needs a field
 * the shared schema has no room for. Each one says why.
 */
import { z } from "zod";
import { CostWarning, ImportBatch, PaymentCertTransition, UnmatchedRow } from "@ecapital/shared";
import { isPeriod } from "./source/values";

/** A rule that fired on one row of an import, in both languages. */
export const ImportException = z.object({
  id: z.string(),
  rule: z.string(),
  severity: z.enum(["ERROR", "WARN", "INFO"]),
  rowNo: z.number().int().nullable(),
  value: z.string().nullable(),
  messageEl: z.string(),
  messageEn: z.string(),
  costTxnId: z.string().nullable(),
});
export type ImportException = z.infer<typeof ImportException>;

/**
 * What `POST /cost/imports` and `GET /cost/imports/:id` answer: the batch as
 * the shared contract defines it, plus the first fifty exceptions.
 *
 * A dry run writes nothing, so the exceptions are the whole of its answer —
 * CAPEX-01 §9 and ADR-0016 both make reading what would happen the normal
 * case and writing the exception you ask for.
 */
export const ImportBatchResult = ImportBatch.extend({
  exceptions: z.array(ImportException),
});
export type ImportBatchResult = z.infer<typeof ImportBatchResult>;

export const ImportBatchList = z.object({
  items: z.array(ImportBatch),
  total: z.number().int(),
});
export type ImportBatchList = z.infer<typeof ImportBatchList>;

/**
 * The fields beside the file in the multipart body. They arrive as strings
 * because that is what a multipart form carries, and `dryRun` is true unless
 * somebody says otherwise — see ADR-0016 on why the dry run is the default.
 */
export const ImportRequest = z.object({
  report: z.enum(["ME2N", "KSB1", "FBL1N"]),
  period: z.string().refine(isPeriod, "a period is YYYY-MM"),
  dryRun: z
    .union([z.boolean(), z.string()])
    .default(true)
    .transform((value) => (typeof value === "boolean" ? value : value !== "false" && value !== "0")),
});
export type ImportRequest = z.infer<typeof ImportRequest>;

export const SkipRequest = z.object({
  txnIds: z.array(z.string()).min(1),
});
export type SkipRequest = z.infer<typeof SkipRequest>;

/** What an allocation leaves behind: how many rows are left, and the next one. */
export const AllocationResult = z.object({
  remaining: z.number().int(),
  next: UnmatchedRow.nullable(),
});
export type AllocationResult = z.infer<typeof AllocationResult>;

/**
 * R11. `PaymentCertTransition` in the shared contract carries the invoice
 * reference and the paid date and nothing else. Releasing the retention is
 * the one other thing that happens to a certificate, it happens on the same
 * screen and at the same moment, and it needs a rule of its own (R31:
 * released before the defects-liability period ends fires a warning and does
 * not block). It is optional, so a body written against the shared schema is
 * still valid. ADR-0021 records the addition.
 */
export const PaymentCertTransitionBody = PaymentCertTransition.extend({
  retentionReleased: z.boolean().optional(),
});
export type PaymentCertTransitionBody = z.infer<typeof PaymentCertTransitionBody>;

/** R17: the window the cash-flow profile is asked for. */
export const CashflowQuery = z.object({
  from: z.string().refine(isPeriod, "a period is YYYY-MM").optional(),
  to: z.string().refine(isPeriod, "a period is YYYY-MM").optional(),
});
export type CashflowQuery = z.infer<typeof CashflowQuery>;

/** R18: the year the accrual proposal is for, and optionally one unit. */
export const AccrualQuery = z.object({
  year: z.coerce.number().int().min(2000).max(9999),
  orgUnitId: z.string().min(1).optional(),
});
export type AccrualQuery = z.infer<typeof AccrualQuery>;

/**
 * One line of the approved budget, as finance writes it (ADR-0014: after
 * APPROVED the budget is finance's). The vintage defaults to the one the
 * system opens for figures typed in eCapital rather than imported, so a
 * revision of the capex plan and a correction made here never overwrite each
 * other.
 */
export const BudgetLineWrite = z.object({
  budgetYear: z.number().int().min(2000).max(9999),
  amount: z.number(),
  category: z.enum(["works", "equipment", "fees", "contingency", "other"]).nullable().default(null),
  sapGl: z.string().nullable().default(null),
  lineType: z.enum(["BUDGET", "FORECAST"]).default("BUDGET"),
});
export type BudgetLineWrite = z.infer<typeof BudgetLineWrite>;

export const BudgetLinesWrite = z.object({
  vintageId: z.string().min(1).optional(),
  lines: z.array(BudgetLineWrite),
});
export type BudgetLinesWrite = z.infer<typeof BudgetLinesWrite>;

export const BudgetLineList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      orgUnitId: z.string(),
      projectId: z.string().nullable(),
      vintageId: z.string(),
      lineType: z.enum(["BUDGET", "FORECAST"]),
      budgetYear: z.number().int(),
      category: z.string().nullable(),
      sapGl: z.string().nullable(),
      amount: z.number(),
    }),
  ),
  total: z.number().int(),
  /** The vintage `PUT` writes into, so the screen can say which one it edits. */
  vintageId: z.string(),
});
export type BudgetLineList = z.infer<typeof BudgetLineList>;

export const CostWarningList = z.object({
  items: z.array(CostWarning),
  total: z.number().int(),
});
export type CostWarningList = z.infer<typeof CostWarningList>;

/** The vintage budget lines typed in eCapital belong to (ADR-0021). */
export const SYSTEM_VINTAGE = "ecapital";
