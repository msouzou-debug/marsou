import { z } from "zod";

// ------------------------------------------------------------ M2 (R11, R13–R18, R31)
// CAPEX-01 §7: four ledgers, never collapsed. Approved from budget_line;
// committed from contracts (+ approved variations) or the SAP PO balance once
// ingestion is live; actuals from SAP postings; forecast = committed +
// pending variations × weight + contingency. Cost-to-complete = forecast − spent.

export const CostTxnType = z.enum(["COMMITMENT", "ACTUAL", "ACCRUAL"]);
export type CostTxnType = z.infer<typeof CostTxnType>;

export const CostSource = z.enum(["SAP_EXTRACT", "SAP_MCP", "MANUAL", "EXCEL_MIGRATION"]);
export type CostSource = z.infer<typeof CostSource>;

export const CostTxn = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  projectId: z.string().nullable(),
  contractId: z.string().nullable(),
  workOrderId: z.string().nullable(), // M5
  assetId: z.string().nullable(), // M4
  budgetLineId: z.string().nullable(),
  txnType: CostTxnType,
  source: CostSource,
  sourceRef: z.string(), // SAP document number / PO item / migration row
  docDate: z.string().nullable(),
  postingDate: z.string(),
  amount: z.number(), // EUR, sign as posted (credits negative)
  currency: z.literal("EUR"),
  description: z.string(),
  vendorName: z.string().nullable(),
  sapWbs: z.string().nullable(),
  sapPo: z.string().nullable(),
  costCentre: z.string().nullable(),
  glAccount: z.string().nullable(),
  importBatchId: z.string().nullable(),
  // RULE (R14): how the row found its project. Manual allocations are audited
  // and remembered so the same vendor + text matches next month.
  matchedBy: z.enum(["WBS", "PO", "COST_CENTRE", "MANUAL", "RULE", "NONE"]),
});
export type CostTxn = z.infer<typeof CostTxn>;

// SAP file extracts (phase 1). The column map is a YAML profile per report,
// like the Capex importer; the same CostSource interface later wraps the MCP.
export const SapReport = z.enum(["ME2N", "KSB1", "FBL1N"]);
export type SapReport = z.infer<typeof SapReport>;

export const ImportBatchStatus = z.enum(["DRY_RUN", "PENDING_ALLOCATION", "COMMITTED", "FAILED"]);
export type ImportBatchStatus = z.infer<typeof ImportBatchStatus>;

export const ImportBatch = z.object({
  id: z.string(),
  source: CostSource,
  report: SapReport.nullable(),
  fileName: z.string(),
  fileSha256: z.string(),
  profileId: z.string(),
  period: z.string(), // YYYY-MM
  rowsIn: z.number().int(),
  rowsMatched: z.number().int(),
  rowsUnmatched: z.number().int(),
  rowsRejected: z.number().int(),
  amountIn: z.number(),
  amountMatched: z.number(),
  status: ImportBatchStatus,
  importedById: z.string(),
  importedByName: z.string(),
  importedAt: z.string(),
  errorEl: z.string().nullable(),
  errorEn: z.string().nullable(),
});
export type ImportBatch = z.infer<typeof ImportBatch>;

// S10: one unmatched row and what the system suggests for it.
export const Suggestion = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectTitleEl: z.string(),
  contractId: z.string().nullable(),
  contractRef: z.string().nullable(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  // Shown as text («Υψηλή αντιστοιχία — ίδιος κωδικός WBS»); key resolved by the UI.
  reason: z.enum(["SAME_WBS", "SAME_PO", "SAME_COST_CENTRE", "REMEMBERED_VENDOR", "SIMILAR_TEXT"]),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const UnmatchedRow = z.object({
  txn: CostTxn,
  suggestions: z.array(Suggestion).max(9), // 1–9 keys on S10
});
export type UnmatchedRow = z.infer<typeof UnmatchedRow>;

export const UnmatchedQueue = z.object({
  batchId: z.string(),
  remaining: z.number().int(),
  total: z.number().int(),
  items: z.array(UnmatchedRow),
});
export type UnmatchedQueue = z.infer<typeof UnmatchedQueue>;

export const Allocation = z.object({
  txnIds: z.array(z.string()).min(1),
  projectId: z.string(),
  contractId: z.string().nullable().default(null),
  // RULE (R14): remembering turns this allocation into a rule for the
  // vendor + normalised text, applied on the next import as matchedBy RULE.
  remember: z.boolean().default(true),
});
export type Allocation = z.infer<typeof Allocation>;

// Budget lines (approved budget by year, per vintage) — CAPEX-01 §4, CAPEX-03 §2.
export const BudgetLineType = z.enum(["BUDGET", "FORECAST"]);
export type BudgetLineType = z.infer<typeof BudgetLineType>;

export const BudgetLine = z.object({
  id: z.string(),
  orgUnitId: z.string(),
  projectId: z.string().nullable(),
  vintageId: z.string(), // "2026-02", "2025-prior", or a system vintage
  lineType: BudgetLineType,
  budgetYear: z.number().int(), // 9999 = beyond horizon
  category: z.string().nullable(),
  sapGl: z.string().nullable(),
  amount: z.number(),
});
export type BudgetLine = z.infer<typeof BudgetLine>;

// Forecast inputs the engineer sets (R16).
export const ForecastInputs = z.object({
  contingency: z.number().nonnegative().default(0),
  // Weight applied to SUBMITTED variations, 0–1. Default 0.5.
  pendingVariationWeight: z.number().min(0).max(1).default(0.5),
  contingencyNoteEl: z.string().nullable().default(null),
});
export type ForecastInputs = z.infer<typeof ForecastInputs>;

// S04: the four ledgers by cost category with variance (forecast − approved).
export const CostCategoryRow = z.object({
  category: z.string(), // i18n key suffix, e.g. "works", "equipment", "fees", "contingency"
  approved: z.number().nullable(),
  committed: z.number().nullable(),
  spent: z.number().nullable(),
  forecast: z.number().nullable(),
  variance: z.number().nullable(),
});
export type CostCategoryRow = z.infer<typeof CostCategoryRow>;

// Warn-and-flag rules (R31). Never blocking. Dismissal is audited.
export const CostWarningKey = z.enum([
  "commitmentOverYearBudget",
  "forecastOverApproved",
  "variationsOverTenPct",
  "certifiedOverContract",
  "retentionBeforeDlpEnd",
]);
export type CostWarningKey = z.infer<typeof CostWarningKey>;

export const CostWarning = z.object({
  id: z.string(),
  key: CostWarningKey,
  projectId: z.string(),
  contractId: z.string().nullable(),
  sentenceEl: z.string(),
  sentenceEn: z.string(),
  amount: z.number().nullable(),
  firedAt: z.string(),
  dismissedById: z.string().nullable(),
  dismissedByName: z.string().nullable(),
  dismissedAt: z.string().nullable(),
});
export type CostWarning = z.infer<typeof CostWarning>;

export const ProjectCost = z.object({
  projectId: z.string(),
  ledgers: z.object({
    approved: z.number(),
    committed: z.number().nullable(),
    spent: z.number().nullable(),
    forecast: z.number().nullable(),
    costToComplete: z.number().nullable(),
  }),
  // RULE (CAPEX-01 §7): committed shows its provenance so nobody mixes the
  // contract ledger with the SAP PO balance without knowing.
  committedSource: z.enum(["CONTRACTS", "SAP_PO", "NONE"]),
  forecastInputs: ForecastInputs,
  categories: z.array(CostCategoryRow),
  warnings: z.array(CostWarning),
  lastSapImportAt: z.string().nullable(),
});
export type ProjectCost = z.infer<typeof ProjectCost>;

// Payment certificates (R11). Retention is its own line, never netted silently.
export const PaymentCertStatus = z.enum(["DRAFT", "ENGINEER_APPROVED", "FINANCE_RECEIVED", "PAID"]);
export type PaymentCertStatus = z.infer<typeof PaymentCertStatus>;

export const PaymentCert = z.object({
  id: z.string(),
  contractId: z.string(),
  orgUnitId: z.string(),
  number: z.number().int(), // per contract
  periodFrom: z.string(),
  periodTo: z.string(),
  workDoneValue: z.number().nonnegative(), // cumulative work done to date
  materialsOnSite: z.number().nonnegative(),
  // Derived by the API: retentionHeld = retentionPct × (workDone + materials);
  // netPayable = workDone + materials − retentionHeld − previousCertified.
  retentionHeld: z.number(),
  previousCertified: z.number(),
  netPayable: z.number(),
  status: PaymentCertStatus,
  createdById: z.string(),
  createdByName: z.string(),
  // RULE (CAPEX-01 §10): approval requires a different user from the creator.
  approvedById: z.string().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  sapInvoiceRef: z.string().nullable(),
  paidDate: z.string().nullable(),
  retentionReleased: z.boolean(),
});
export type PaymentCert = z.infer<typeof PaymentCert>;

export const PaymentCertCreate = PaymentCert.pick({
  periodFrom: true,
  periodTo: true,
  workDoneValue: true,
  materialsOnSite: true,
});
export type PaymentCertCreate = z.infer<typeof PaymentCertCreate>;

export const PaymentCertTransition = z.object({
  to: PaymentCertStatus,
  sapInvoiceRef: z.string().nullable().default(null), // required for FINANCE_RECEIVED
  paidDate: z.string().nullable().default(null), // required for PAID
});
export type PaymentCertTransition = z.infer<typeof PaymentCertTransition>;

// Cash flow (R17): by month, per project or unit.
export const CashflowRow = z.object({
  period: z.string(), // YYYY-MM
  planned: z.number().nullable(), // budget_line spread over the year
  actual: z.number().nullable(), // sum of ACTUAL postings in the month
  cumulativePlanned: z.number().nullable(),
  cumulativeActual: z.number().nullable(),
});
export type CashflowRow = z.infer<typeof CashflowRow>;

// Year-end accrual proposal (R18): certified, not yet invoiced.
export const AccrualRow = z.object({
  projectId: z.string(),
  projectCode: z.string(),
  projectTitleEl: z.string(),
  contractId: z.string(),
  contractRef: z.string(),
  contractorName: z.string(),
  costCentre: z.string().nullable(),
  certNumber: z.number().int(),
  certifiedNet: z.number(),
  invoiced: z.number(),
  accrual: z.number(), // certifiedNet − invoiced
  asOf: z.string(),
});
export type AccrualRow = z.infer<typeof AccrualRow>;
